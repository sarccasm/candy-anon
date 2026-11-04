import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeOrder,listAdminOrders,encodeOrderCursor,decodeOrderCursor} from '../edge/lib/admin-orders.mjs';

const token='12345678-1234-4234-8234-123456789abc',now=Date.now();
const secret='test-only-admin-orders-key-0123456789';
const invoice={token,amountSats:50000,settledSats:50000,committed:true,addressAllocationVersion:1,
 paymentStatus:'PAID',createdAt:new Date(now-60000).toISOString(),lastPaymentCheckAt:new Date(now).toISOString(),
 items:{c1:2},fulfillment:{status:'PENDING',idempotencyKey:token,encryptedBlob:token+'.asc'},
 address:'private-bitcoin-address',customerName:'PRIVATE NAME',data:'PRIVATE CIPHERTEXT',
 lastPaymentError:'PRIVATE DEBUG ERROR',_etag:'PRIVATE ETAG'};
const row=patch=>({rowKey:token,payload:JSON.stringify({...invoice,...patch})});
function clientFor(page,onOptions=()=>{}) {
 return {listEntities(){return {byPage(options){onOptions(options);return (async function*(){yield page;})();}};}};
}
test('admin summary contains technical fields without bearer secrets or delivery data',()=>{
 const result=summarizeOrder(row(),now),serialized=JSON.stringify(result);
 for(const value of [token,invoice.address,invoice.customerName,invoice.data,invoice.lastPaymentError,invoice._etag])
  assert.equal(serialized.includes(value),false);
 assert.equal(result.reference.length,24);assert.equal(result.needsReview,false);
 assert.equal(result.fulfillmentStatus,'PENDING');assert.deepEqual(result.items,[{sku:'c1',quantity:2}]);
});
test('late, partial, stale, held, legacy and corrupt records require attention',()=>{
 for(const patch of [{paymentStatus:'LATE_PAYMENT'},{paymentStatus:'PARTIALLY_PAID'},
  {fulfillment:{status:'ON_HOLD'}},{lastPaymentCheckAt:new Date(now-6*60000).toISOString()},
  {addressAllocationVersion:undefined},{settledSats:0},{token:'wrong'}])
  assert.equal(summarizeOrder(row(patch),now).needsReview,true);
 const corrupt=summarizeOrder({rowKey:token,payload:'{broken'},now);
 assert.equal(corrupt.paymentStatus,'INVOICE_REVIEW');assert.equal(corrupt.amountSats,null);
 assert.equal(summarizeOrder({rowKey:'catalog:v1',payload:'[]'},now),null);
});
test('filters select matching records and keep continuation through empty filtered pages',async()=>{
 const page=[row(),row({paymentStatus:'PARTIALLY_PAID'})];page.continuationToken='secret-next-'+token;
 const paid=await listAdminOrders({client:clientFor(page),filter:'paid',secret,now});
 assert.equal(paid.orders.length,1);
 const pending=await listAdminOrders({client:clientFor(page),filter:'pending',secret,now});
 assert.equal(pending.orders.length,0);assert.ok(pending.nextCursor);
 let supplied;
 await listAdminOrders({client:clientFor([],(options)=>{supplied=options.continuationToken;}),
  filter:'pending',secret,now,cursor:pending.nextCursor});
 assert.equal(supplied,page.continuationToken);
 await assert.rejects(()=>listAdminOrders({client:clientFor([]),filter:'bad',secret}),/invalid_filter/);
});
test('cursor hides row keys, rejects tampering, mismatched filter, expiry and rotated keys',()=>{
 const raw='next-row-'+token;
 const cursor=encodeOrderCursor(raw,'all',secret,now);
 assert.equal(Buffer.from(cursor,'base64url').includes(Buffer.from(token)),false);
 assert.equal(decodeOrderCursor(cursor,'all',secret,now),raw);
 const bytes=Buffer.from(cursor,'base64url');bytes[30]^=1;
 for(const attempt of [()=>decodeOrderCursor(bytes.toString('base64url'),'all',secret,now),
  ()=>decodeOrderCursor(cursor,'review',secret,now),()=>decodeOrderCursor(cursor,'all',secret,now+31*60000),
  ()=>decodeOrderCursor(cursor,'all',secret+'rotated',now),()=>decodeOrderCursor('bad!','all',secret,now)])
  assert.throws(attempt,/invalid_cursor/);
});

process.env.ADMIN_KEY=secret;
process.env.ALLOWED_ORIGIN='https://admin.example.test';
const {createAdminOrdersHandler}=await import('../edge/AdminOrders/index.mjs');
test('orders endpoint authenticates before storage and rejects writes',async()=>{
 let calls=0;const handler=createAdminOrdersHandler({getStore:async()=>{calls++;return {client:clientFor([])};}});
 const context={res:{}};
 await handler(context,{method:'GET',query:{key:secret}});assert.equal(context.res.status,401);assert.equal(calls,0);
 await handler(context,{method:'POST',headers:{'x-admin-key':secret}});assert.equal(context.res.status,405);assert.equal(calls,0);
 await handler(context,{method:'OPTIONS'});assert.equal(context.res.status,204);
 assert.equal(context.res.headers['Access-Control-Allow-Origin'],process.env.ALLOWED_ORIGIN);
 await handler(context,{method:'GET',headers:{'x-admin-key':secret},query:{}});
 assert.equal(context.res.status,200);assert.equal(context.res.headers['Cache-Control'],'no-store');assert.equal(calls,1);
});
test('orders endpoint distinguishes storage errors from an empty result',async()=>{
 const handler=createAdminOrdersHandler({getStore:async()=>{throw Error('PRIVATE storage connection');}});
 const context={res:{}};await handler(context,{method:'GET',headers:{'x-admin-key':secret}});
 assert.equal(context.res.status,503);assert.equal(context.res.body.includes('PRIVATE'),false);
});
