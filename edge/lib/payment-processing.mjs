import {releaseUnpaidReservation} from './stock-reservations.mjs';
import { settleInvoiceAtomically } from './atomic-settlement.mjs';
import { observeBitcoinInvoice } from './esplora-watcher.mjs';
import { paymentStatusForClient } from './payment-status-response.mjs';
import { verifyIndependentPayment } from './independent-payment-check.mjs';
import { committedInvoiceIntegrity } from './committed-invoice-integrity.mjs';
import { validToken } from './encrypted-fulfillment.mjs';

const response = (code, body) => ({code,body});
export function paymentConfiguration(env=process.env) {
  return {providers:[env.BLOCKSTREAM_API || 'https://blockstream.info/api',
    env.ESPLORA_FALLBACK || 'https://mempool.space/api'],
    requiredConfirmations:Number(env.MIN_CONFIRMATIONS || 2)};
}

async function verifyAndSettle({store,escrow,token,observe,providers,requiredConfirmations,now}) {
  let invoice;
  try { invoice=await store.read(token); }
  catch { return response(503,{paid:false,error:'invoice_store_unavailable'}); }
  if(!invoice)return response(404,{paid:false,error:'not_found'});
  if(invoice.committed!==true && invoice.addressAllocationVersion!==1)
    return response(409,{paid:false,status:'INVOICE_REVIEW',error:'legacy_invoice_requires_review'});
  if(typeof invoice.address!=='string'||!Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0)
    return response(500,{paid:false,status:'INVOICE_REVIEW',error:'bad_invoice'});
  if(!committedInvoiceIntegrity(invoice))
    return response(409,{paid:false,status:'INVOICE_REVIEW',error:'manual_review_required'});
  if(!Number.isSafeInteger(requiredConfirmations)||requiredConfirmations<1||requiredConfirmations>100)
    return response(500,{paid:false,error:'invalid_confirmation_config'});
  let sources;
  try {
    sources=providers.map(source=>new URL(source).href.replace(/\/$/,''));
    if(sources.length!==2||sources.some(source=>!source.startsWith('https://'))||
      new URL(sources[0]).origin===new URL(sources[1]).origin)throw Error();
  } catch { return response(503,{paid:false,error:'independent_provider_required'}); }
  let observation, observedProvider;
  for(const baseUrl of sources) {
    try {
      observation=await observe({address:invoice.address,expectedSats:invoice.amountSats,
        requiredConfirmations,baseUrl,expired:false});
      observedProvider=baseUrl;
      break;
    } catch { /* A failed provider must not authorize settlement. */ }
  }
  if(!observation)return response(503,{paid:false,error:'verification_unavailable'});
  if(observation.status!=='PAID') {
    if(invoice.committed===true)return paymentStatusForClient(invoice,observation);
    const issuedAt=Date.parse(invoice.createdAt);
    if(!Number.isFinite(issuedAt))return response(503,{paid:false,error:'invalid_invoice_timestamp'});
    if(now()>issuedAt+20*60_000){
      if(invoice.reservation?.status==='ACTIVE'&&observation.receivedSats===0){
        if(observedProvider!==sources[0])return response(503,{paid:false,error:'independent_provider_required'});
        try {
          const second=await observe({address:invoice.address,expectedSats:invoice.amountSats,requiredConfirmations,baseUrl:sources[1]});
          if(second.receivedSats!==0)return response(409,{paid:false,status:'PROVIDER_DISAGREEMENT',error:'manual_review_required'});
          await releaseUnpaidReservation(store,token,[observation,second],now());
        }catch{return response(503,{paid:false,status:'RESERVATION_RELEASE_PENDING',error:'independent_verification_unavailable'});}
      }
      return response(observation.receivedSats>0?409:200,{paid:false,
        status:observation.receivedSats>0?'LATE_PAYMENT':'EXPIRED',
        ...(observation.receivedSats>0?{error:'manual_review_required'}:{})});
    }
    return paymentStatusForClient(invoice,observation);
  }
  const issuedAt=Date.parse(invoice.createdAt);
  if(!Number.isFinite(issuedAt))return response(503,{paid:false,error:'invalid_invoice_timestamp'});
  if(now()>issuedAt+20*60_000&&!invoice.committed)
    return response(409,{paid:false,status:'LATE_PAYMENT',error:'manual_review_required'});
  if(observedProvider!==sources[0])
    return response(503,{paid:false,error:'independent_provider_required'});
  let independent;
  try {
    independent=await observe({address:invoice.address,expectedSats:invoice.amountSats,
      requiredConfirmations,baseUrl:sources[1]});
  } catch { return response(503,{paid:false,error:'independent_verification_unavailable'}); }
  if(!verifyIndependentPayment(observation,independent,invoice.amountSats))
    return response(409,{paid:false,status:invoice.committed?'REORG_REVIEW':'PROVIDER_DISAGREEMENT',
      error:'manual_review_required'});
  try {
    // The encrypted payload must still exist before an order may be queued.
    if(!(await escrow.exists(token)))return response(409,{paid:false,status:'ESCROW_MISSING'});
    if(invoice.committed!==true) {
      const result=await settleInvoiceAtomically(store,token,independent);
      if(!result.ok)throw Error('settlement_failed');
    }
  } catch(error) {
    return response(503,{paid:false,status:'SETTLEMENT_PENDING',
      error:error.message==='late_payment_manual_review'?'manual_review_required':'settlement_unavailable'});
  }
  return response(200,{paid:true,status:'PAID',confs:observation.confirmations,
    fulfillmentStatus:invoice.addressAllocationVersion===1?'PENDING':'MANUAL_REVIEW'});
}

// Same verification path for HTTP polling, shipment retries and the scheduled worker.
export async function reconcileInvoice({store,escrow,token,observe=observeBitcoinInvoice,
  providers=paymentConfiguration().providers,requiredConfirmations=paymentConfiguration().requiredConfirmations,
  now=Date.now}) {
  if(!validToken(token))return response(400,{paid:false,error:'invalid_token'});
  // A slow provider must not monopolize a scheduled batch. The watcher propagates
  // cancellation through history pagination, response bodies and final tip checks.
  const boundedObserve=async args=>{
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),20_000);
    try { return await observe({...args,signal:ctrl.signal}); }
    finally {clearTimeout(timeout);}
  };
  const result=await verifyAndSettle({store,escrow,token,observe:boundedObserve,providers,requiredConfirmations,now});
  if(result.code===404 || result.body.error==='invoice_store_unavailable')return result;
  // Persist the latest check and hold queued work on reorgs or unavailable verification.
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const latest=await store.read(token);
      if(!latest)return response(404,{paid:false,error:'not_found'});
      const updated=await store.compareAndSwap(token,latest._etag,record=>{
        const next={...record,paymentStatus:result.body.status || 'VERIFICATION_UNAVAILABLE',
          lastPaymentCheckAt:new Date(now()).toISOString(),lastPaymentError:result.body.error || null};
        if(record.committed===true && record.addressAllocationVersion===1) {
          const job=record.fulfillment || {idempotencyKey:token,encryptedBlob:token+'.asc',
            createdAt:record.committedAt || new Date(now()).toISOString()};
          if(job.status && !['PENDING','ON_HOLD','HANDOFF_READY','FULFILLED'].includes(job.status))throw Error('fulfillment_requires_review');
          const blocked=result.body.paid!==true||record.review?.state==='OPEN'||record.refundRecordedExternally===true;
          const resumeStatus=job.status==='HANDOFF_READY'||job.resumeStatus==='HANDOFF_READY'?'HANDOFF_READY':'PENDING';
          next.fulfillment={...job,paymentHold:result.body.paid!==true,
            status:job.status==='FULFILLED'?'FULFILLED':blocked?'ON_HOLD':resumeStatus,
            ...(blocked&&job.status!=='FULFILLED'?{resumeStatus}:{})};
        }
        return next;
      });
      if(result.body.paid===true&&updated.fulfillment)result.body.fulfillmentStatus=updated.fulfillment.status;
      return result;
    } catch(error) {
      if(error.message==='version_conflict')continue;
      break;
    }
  }
  return response(503,{paid:false,error:'payment_state_unavailable'});
}
