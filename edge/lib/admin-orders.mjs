import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {validToken} from './encrypted-fulfillment.mjs';
import {committedInvoiceIntegrity} from './committed-invoice-integrity.mjs';

const statuses=new Set(['PENDING','PARTIALLY_PAID','CONFIRMING','PAID','EXPIRED','LATE_PAYMENT',
  'RESERVATION_RELEASE_PENDING','REORG_REVIEW','INVOICE_REVIEW','PROVIDER_DISAGREEMENT','ESCROW_MISSING','SETTLEMENT_PENDING','VERIFICATION_UNAVAILABLE']);
const attention=new Set(['PARTIALLY_PAID','LATE_PAYMENT','RESERVATION_RELEASE_PENDING','REORG_REVIEW','INVOICE_REVIEW',
  'PROVIDER_DISAGREEMENT','ESCROW_MISSING','SETTLEMENT_PENDING','VERIFICATION_UNAVAILABLE']);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const amount=value=>Number.isSafeInteger(value)&&value>=0?value:null;

export function summarizeOrder(row,now=Date.now()) {
  if(!validToken(row.rowKey))return null;
  const reference=createHash('sha256').update('admin-order:'+row.rowKey).digest('hex').slice(0,24);
  let invoice;
  try {invoice=JSON.parse(row.payload);} catch {invoice=null;}
  const corrupt=!invoice || invoice.token!==row.rowKey || !committedInvoiceIntegrity(invoice) ||
    !Number.isSafeInteger(invoice.amountSats) || invoice.amountSats<=0;
  if(corrupt)return {reference,paymentStatus:'INVOICE_REVIEW',fulfillmentStatus:null,needsReview:true,
    verificationStale:true,createdAt:null,lastCheckedAt:null,amountSats:null,settledSats:null,items:[]};
  const createdAt=date(invoice.createdAt),lastCheckedAt=date(invoice.lastPaymentCheckAt);
  const verificationStale=!lastCheckedAt || now-Date.parse(lastCheckedAt)>5*60_000;
  let paymentStatus=invoice.paymentStatus;
  if(paymentStatus!==undefined && !statuses.has(paymentStatus))paymentStatus='INVOICE_REVIEW';
  if(paymentStatus===undefined)paymentStatus=invoice.committed===true?'PAID':
    createdAt&&now-Date.parse(createdAt)>20*60_000?'EXPIRED':'PENDING';
  if(!createdAt || invoice.addressAllocationVersion!==1)paymentStatus='INVOICE_REVIEW';
  if((paymentStatus==='PAID'||invoice.fulfillment) && invoice.committed!==true)paymentStatus='INVOICE_REVIEW';
  const fulfillmentStatus=['PENDING','ON_HOLD','HANDOFF_READY','FULFILLED'].includes(invoice.fulfillment?.status)
    ?invoice.fulfillment.status:null;
  const items=Object.entries(invoice.items || {}).slice(0,50)
    .filter(([sku,quantity])=>/^[a-zA-Z0-9_-]{1,64}$/.test(sku)&&Number.isSafeInteger(quantity)&&quantity>0)
    .map(([sku,quantity])=>({sku,quantity}));
  return {reference,paymentStatus,fulfillmentStatus,
    needsReview:attention.has(paymentStatus)||fulfillmentStatus==='ON_HOLD'||invoice.review?.state==='OPEN'||invoice.fulfillment?.paymentHold===true||
      (invoice.committed===true && (verificationStale||!fulfillmentStatus)),
    verificationStale,createdAt,lastCheckedAt,amountSats:amount(invoice.amountSats),
    settledSats:amount(invoice.settledSats),items};
}

// Azure continuation tokens can contain invoice bearer secrets. Encrypt, authenticate
// and expire cursors before exposing them to the browser, even to an administrator.
function cursorKey(secret) {
  if(typeof secret!=='string'||secret.length<24)throw Error('cursor_key_unavailable');
  return createHash('sha256').update('admin-orders-cursor-v1:'+secret).digest();
}
export function encodeOrderCursor(continuationToken,filter,secret,now=Date.now()) {
  if(!continuationToken)return null;
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cursorKey(secret),iv);
  const payload=JSON.stringify({v:1,continuationToken,filter,expiresAt:now+30*60_000});
  const encrypted=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function decodeOrderCursor(cursor,filter,secret,now=Date.now()) {
  if(!cursor)return undefined;
  try {
    if(typeof cursor!=='string'||cursor.length>12000||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw Error();
    const bytes=Buffer.from(cursor,'base64url');
    const decipher=createDecipheriv('aes-256-gcm',cursorKey(secret),bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    const payload=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
    if(payload.v!==1||payload.filter!==filter||!Number.isFinite(payload.expiresAt)||payload.expiresAt<=now||
      typeof payload.continuationToken!=='string')throw Error();
    return payload.continuationToken;
  } catch {throw Error('invalid_cursor');}
}

export async function listAdminOrders({client,filter='all',cursor,secret,now=Date.now()}) {
  if(!['all','review','paid','pending'].includes(filter))throw Error('invalid_filter');
  const continuationToken=decodeOrderCursor(cursor,filter,secret,now);
  const iterator=client.listEntities({queryOptions:{
    filter:"PartitionKey eq 'invoices' and RowKey gt '' and RowKey lt 'g'"
  }}).byPage({maxPageSize:50,continuationToken});
  const {value:page}=await iterator.next();
  const orders=(page || []).map(row=>summarizeOrder(row,now)).filter(Boolean).filter(order=>
    filter==='all'||filter==='review'&&order.needsReview||filter==='paid'&&order.paymentStatus==='PAID'||
    filter==='pending'&&['PENDING','CONFIRMING'].includes(order.paymentStatus));
  orders.sort((a,b)=>(b.createdAt || '').localeCompare(a.createdAt || '') || a.reference.localeCompare(b.reference));
  return {orders,nextCursor:encodeOrderCursor(page?.continuationToken,filter,secret,now)};
}
