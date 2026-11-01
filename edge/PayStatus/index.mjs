import { config as loadEnv } from 'dotenv';
loadEnv();

import { json, options } from '../lib/http.mjs';
import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { azureEscrowFromEnvironment } from '../lib/azure-encrypted-escrow.mjs';
import { settleInvoiceAtomically } from '../lib/atomic-settlement.mjs';
import { observeBitcoinInvoice } from '../lib/esplora-watcher.mjs';

// Payment verification and durable settlement. Missing inventory or escrow fails closed.
const providers = [process.env.BLOCKSTREAM_API || 'https://blockstream.info/api',
  process.env.ESPLORA_FALLBACK || 'https://mempool.space/api'];

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'GET') return json(context.res,{error:'method_not_allowed'},405);
  const token=String(req.query?.token||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))
    return json(context.res,{error:'invalid_token'},400);
  let invoice;
  try { invoice=await (await invoiceStoreFromEnvironment()).read(token); }
  catch { return json(context.res,{error:'invoice_store_unavailable'},503); }
  if(!invoice)return json(context.res,{error:'not_found'},404);
  if(typeof invoice.address!=='string'||!Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0)
    return json(context.res,{error:'bad_invoice'},500);
  const required=Number(process.env.MIN_CONFIRMATIONS || 2);
  if(!Number.isSafeInteger(required)||required<1||required>100)
    return json(context.res,{error:'invalid_confirmation_config'},500);
  let observation;
  let observedProvider;
  for(const baseUrl of providers) {
    try {
      observation=await observeBitcoinInvoice({address:invoice.address,expectedSats:invoice.amountSats,
        requiredConfirmations:required,baseUrl,expired:false});
      observedProvider=baseUrl;
      break;
    } catch (error) {
      context.log?.warn?.('BTC provider failed verification');
    }
  }
  if(!observation)return json(context.res,{paid:false,error:'verification_unavailable'},503);
  if(observation.status!=='PAID') {
    if(invoice.committed===true)
      return json(context.res,{paid:false,status:'REORG_REVIEW',error:'manual_review_required'},409);
    return json(context.res,{paid:false,status:observation.status,confs:observation.confirmations},200);
  }
  const issuedAt=Date.parse(invoice.createdAt);
  if(!Number.isFinite(issuedAt))return json(context.res,{paid:false,error:'invalid_invoice_timestamp'},503);
  const expired=Date.now()>issuedAt+20*60_000;
  if(expired&&!invoice.committed)
    return json(context.res,{paid:false,status:'LATE_PAYMENT',error:'manual_review_required'},409);
  if(invoice.committed!==true) {
    try {
      if(providers[0]===providers[1] || observedProvider!==providers[0])
        return json(context.res,{paid:false,error:'independent_provider_required'},503);
      const independentlyVerified = await observeBitcoinInvoice({address:invoice.address,
        expectedSats:invoice.amountSats,requiredConfirmations:required,
        baseUrl:providers[1]});
      if(independentlyVerified.status!=='PAID' ||
         independentlyVerified.eligibleSats < invoice.amountSats)
        return json(context.res,{paid:false,status:'PROVIDER_DISAGREEMENT'},503);
      if(!(await (await azureEscrowFromEnvironment()).exists(token)))
        return json(context.res,{paid:false,status:'ESCROW_MISSING'},409);
      const result=await settleInvoiceAtomically(await invoiceStoreFromEnvironment(),token,independentlyVerified);
      if(!result.ok)throw Error('settlement_failed');
    } catch(e) {
      return json(context.res,{paid:false,status:'SETTLEMENT_PENDING',
        error:e?.message==='late_payment_manual_review'?'manual_review_required':'settlement_unavailable'},503);
    }
  }
  return json(context.res,{paid:true,status:'PAID',confs:observation.confirmations},200);
}
