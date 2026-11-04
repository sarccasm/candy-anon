import {createHash} from 'node:crypto';
import {validToken} from './encrypted-fulfillment.mjs';
import {summarizeOrder} from './admin-orders.mjs';
import {reconcileInvoice} from './payment-processing.mjs';

export const reviewCategories=['PAYMENT_CHECK','PARTIAL_PAYMENT','LATE_PAYMENT','STOCK','REFUND_REQUIRED','OTHER'];
const closureReasons=['CHECKED','REFUND_RECORDED_EXTERNALLY','NO_ACTION_NEEDED'];
const safeDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export const orderReference=token=>createHash('sha256').update('admin-order:'+token).digest('hex').slice(0,24);
export async function resolveOrder(store,reference) {
 if(typeof reference!=='string'||!/^[0-9a-f]{24}$/.test(reference))throw Error('invalid_reference');
 try {
  const index=await store.client.getEntity('invoices','order:'+reference);
  if(!validToken(index.token)||orderReference(index.token)!==reference)throw Error('invalid_order_index');
  const invoice=await store.read(index.token);if(!invoice)throw Error('not_found');return invoice;
 } catch(error){if(error.statusCode!==404)throw error;}
 // Compatibility for invoices created before the permanent reference index.
 const pages=store.client.listEntities({queryOptions:{filter:"PartitionKey eq 'invoices' and RowKey gt '' and RowKey lt 'g'"}}).byPage({maxPageSize:50});
 let count=0;
 for await(const page of pages){
  for(const row of page)if(validToken(row.rowKey)&&orderReference(row.rowKey)===reference)return store.read(row.rowKey);
  if(++count>=20&&page.continuationToken)throw Error('lookup_limit_use_token');
 }
 throw Error('not_found');
}
export function orderDetails(invoice) {
 return {...summarizeOrder({rowKey:invoice.token,payload:JSON.stringify(invoice)}),
  operationsVersion:invoice.operationsRevision || 0,
  review:invoice.review?{state:invoice.review.state==='OPEN'?'OPEN':'CLOSED',
   category:reviewCategories.includes(invoice.review.category)?invoice.review.category:'OTHER'}:null,
  refundRecordedExternally:invoice.refundRecordedExternally===true,
  reservationStatus:['ACTIVE','CONSUMED','RELEASED'].includes(invoice.reservation?.status)?invoice.reservation.status:null,
  handoffPreparedAt:safeDate(invoice.fulfillment?.preparedAt),
  handoffAcknowledgedAt:safeDate(invoice.fulfillment?.acknowledgedAt),
  downloadRequestId:validToken(invoice.fulfillment?.prepareRequestId)?invoice.fulfillment.prepareRequestId:null};
}
export async function orderAudit(store,reference) {
 const prefix='ops-audit:'+reference+':';
 const page=await store.client.listEntities({queryOptions:{filter:`PartitionKey eq 'invoices' and RowKey ge '${prefix}' and RowKey lt '${prefix}~'`}})
  .byPage({maxPageSize:100}).next();
 return (page.value || []).filter(row=>['prepare_handoff','acknowledge_handoff','open_review','close_review'].includes(row.action))
  .map(row=>({action:row.action,at:safeDate(row.at) || '',actor:/^[0-9a-f]{16}$/.test(row.actor)?row.actor:'unknown',reasonCode:[...reviewCategories,...closureReasons].includes(row.reasonCode)?row.reasonCode:null}))
  .sort((a,b)=>b.at.localeCompare(a.at));
}
async function priorOperation(store,key,digest) {
 try {
  const row=await store.client.getEntity('invoices',key);
  if(row.digest!==digest)throw Error('idempotency_conflict');return row;
 }catch(error){if(error.statusCode===404)return null;throw error;}
}
export async function performOrderAction({store,escrow,reference,body,actorKey,reconcile=reconcileInvoice}) {
 const {action,requestId,version}=body || {};
 if(!validToken(requestId)||!Number.isSafeInteger(version)||version<0||
  !['prepare_handoff','acknowledge_handoff','open_review','close_review'].includes(action))throw Error('invalid_action');
 if(action==='open_review'&&!reviewCategories.includes(body.category))throw Error('invalid_category');
 if(action==='close_review'&&!closureReasons.includes(body.reasonCode))throw Error('invalid_reason');
 if(action==='acknowledge_handoff'&&(body.confirmed!==true||typeof body.receiptReference!=='string'||
  !/^[a-zA-Z0-9][a-zA-Z0-9 _/-]{2,79}$/.test(body.receiptReference)))throw Error('receipt_required');
 const receiptHash=action==='acknowledge_handoff'?createHash('sha256').update(reference+':'+body.receiptReference.trim()).digest('hex'):null;
 const digest=createHash('sha256').update(JSON.stringify({action,receiptHash,category:action==='open_review'?body.category:undefined,reasonCode:action==='close_review'?body.reasonCode:undefined})).digest('hex');
 const auditKey='ops-audit:'+reference+':'+requestId;
 const prior=await priorOperation(store,auditKey,digest);
 let invoice=await resolveOrder(store,reference);
 if(prior&&action!=='prepare_handoff')return {order:orderDetails(invoice),duplicate:true};
 if(!prior&&(invoice.operationsRevision || 0)!==version)throw Error('operation_conflict');
 let ciphertext;
 if(['prepare_handoff','acknowledge_handoff'].includes(action)){
  const checked=await reconcile({store,escrow,token:invoice.token});
  if(!checked.body.paid)throw Error('payment_requires_review');
  invoice=await store.read(invoice.token);
  if(invoice.review?.state==='OPEN'||invoice.refundRecordedExternally===true||invoice.fulfillment?.paymentHold===true)throw Error('review_open');
  if(!prior&&(invoice.operationsRevision || 0)!==version)throw Error('operation_conflict');
  if(action==='prepare_handoff'){
   if(prior&&invoice.fulfillment?.prepareRequestId!==requestId)throw Error('operation_conflict');
   if(!prior&&invoice.fulfillment?.status!=='PENDING')throw Error('handoff_already_prepared');
   if(prior&&invoice.fulfillment?.status!=='HANDOFF_READY')throw Error('handoff_not_ready');
   ciphertext=await escrow.read(invoice.token);if(!ciphertext)throw Error('encrypted_details_missing');
   if(prior)return {order:orderDetails(invoice),duplicate:true,ciphertext};
  }else if(invoice.fulfillment?.status!=='HANDOFF_READY')throw Error('handoff_not_ready');
 }
 const now=new Date().toISOString(),next={...invoice,operationsRevision:(invoice.operationsRevision || 0)+1};
 if(action==='prepare_handoff')next.fulfillment={...invoice.fulfillment,status:'HANDOFF_READY',method:'MANUAL',preparedAt:now,prepareRequestId:requestId};
 if(action==='acknowledge_handoff')next.fulfillment={...invoice.fulfillment,status:'FULFILLED',method:'MANUAL',acknowledgedAt:now,receiptHash};
 if(action==='open_review'){
  next.review={state:'OPEN',category:body.category,updatedAt:now};
  if(invoice.fulfillment&&invoice.fulfillment.status!=='FULFILLED')next.fulfillment={...invoice.fulfillment,status:'ON_HOLD',
   resumeStatus:invoice.fulfillment.status==='HANDOFF_READY'||invoice.fulfillment.resumeStatus==='HANDOFF_READY'?'HANDOFF_READY':'PENDING'};
 }
 if(action==='close_review'){
  if(invoice.review?.state!=='OPEN')throw Error('review_not_open');
  next.review={...invoice.review,state:'CLOSED',closureReason:body.reasonCode,updatedAt:now};
  if(body.reasonCode==='REFUND_RECORDED_EXTERNALLY')next.refundRecordedExternally=true;
 }
 const {_etag,_version,...clean}=next;
 const audit={partitionKey:'invoices',rowKey:auditKey,action,digest,at:now,
  actor:createHash('sha256').update('admin-key:'+actorKey).digest('hex').slice(0,16),
  ...(action==='open_review'?{reasonCode:body.category}:action==='close_review'?{reasonCode:body.reasonCode}:{})};
 try {
  await store.client.submitTransaction([
   ['update',{partitionKey:'invoices',rowKey:invoice.token,payload:JSON.stringify(clean),version:_version+1},'Replace',{etag:_etag}],
   ['create',audit]
  ]);
 }catch(error){
  if([409,412].includes(error.statusCode)){
   const replay=await priorOperation(store,auditKey,digest);
   if(replay){const current=await store.read(invoice.token);
    if(ciphertext&&(current.fulfillment?.status!=='HANDOFF_READY'||current.review?.state==='OPEN'||current.fulfillment?.paymentHold))throw Error('review_open');
    return {order:orderDetails(current),duplicate:true,...(ciphertext?{ciphertext}:{})};}
   throw Error('operation_conflict');
  }
  throw error;
 }
 if(action==='close_review'&&body.reasonCode!=='REFUND_RECORDED_EXTERNALLY')await reconcile({store,escrow,token:invoice.token});
 const current=await store.read(invoice.token);
 return {order:orderDetails(current),duplicate:false,...(ciphertext?{ciphertext}:{})};
}
