import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';
import {reconcileInvoice} from '../edge/lib/payment-processing.mjs';
import {processPaymentBatch} from '../edge/lib/payment-worker.mjs';
import {paymentTable} from './helpers/payment-table.mjs';

const paid={status:'PAID',eligibleSats:50000,receivedSats:50000,confirmations:2};
async function fixture(patch={}) {
 const {store,client}=paymentTable();const token=randomUUID();
 await store.create({token,address:'bc1qexample12345678901234567890',amountSats:50000,
  createdAt:new Date().toISOString(),items:{c1:2},committed:false,addressAllocationVersion:1,...patch});
 await client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity:5});
 return {store,client,token,escrow:{exists:async()=>true},observe:async()=>paid};
}
const stock=async f=>(await f.client.getEntity('invoices','stock:c1')).quantity;

test('scheduled processing settles and durably queues an order without any browser request',async()=>{
 const f=await fixture();
 const result=await processPaymentBatch(f);
 assert.equal(result.paid,1);
 const order=await new AzureInvoiceStore(f.client).read(f.token);
 assert.equal(order.committed,true);assert.equal(await stock(f),3);
 assert.equal(order.fulfillment.status,'PENDING');
 assert.equal(order.fulfillment.encryptedBlob,f.token+'.asc');
 assert.equal(order.fulfillment.idempotencyKey,f.token);
 assert.deepEqual(Object.keys(order.fulfillment).sort(),['createdAt','encryptedBlob','idempotencyKey','paymentHold','status']);
 await processPaymentBatch({...f,store:new AzureInvoiceStore(f.client)});
 assert.equal(await stock(f),3);
});
test('crash after settlement leaves the task intact and retry cannot double deduct',async()=>{
 const f=await fixture();const update=f.client.updateEntity;
 f.client.updateEntity=async()=>{throw Error('offline');};
 assert.equal((await reconcileInvoice(f)).code,503);
 const settled=await f.store.read(f.token);
 assert.equal(settled.fulfillment.status,'PENDING');assert.equal(await stock(f),3);
 f.client.updateEntity=update;
 assert.equal((await reconcileInvoice({...f,store:new AzureInvoiceStore(f.client)})).body.paid,true);
 assert.equal((await f.store.read(f.token)).fulfillment.createdAt,settled.fulfillment.createdAt);
 assert.equal(await stock(f),3);
});
test('concurrent HTTP and scheduled checks create one durable task and one deduction',async()=>{
 const f=await fixture();
 const results=await Promise.all([reconcileInvoice(f),reconcileInvoice({...f,store:new AzureInvoiceStore(f.client)})]);
 assert.equal(results.every(result=>result.body.paid===true),true);
 assert.equal(await stock(f),3);
 assert.equal((await f.store.read(f.token)).fulfillment.idempotencyKey,f.token);
});
test('partial payment and unavailable providers never queue fulfillment',async()=>{
 for(const observe of [async()=>({...paid,status:'PARTIALLY_PAID',eligibleSats:100,receivedSats:100}),
  async()=>{throw Error('provider_down');}]) {
  const f=await fixture();await reconcileInvoice({...f,observe});
  const record=await f.store.read(f.token);
  assert.equal(record.committed,false);assert.equal(record.fulfillment,undefined);assert.equal(await stock(f),5);
 }
});
test('late partial payments are retained for review and unpaid expiry is visible',async()=>{
 for(const receivedSats of [0,100,50000]){
  const f=await fixture({createdAt:new Date(Date.now()-21*60_000).toISOString()});
  const result=await reconcileInvoice({...f,observe:async()=>({...paid,
   status:receivedSats===50000?'PAID':'PARTIALLY_PAID',receivedSats})});
  assert.equal(result.body.status,receivedSats?'LATE_PAYMENT':'EXPIRED');
  assert.equal((await f.store.read(f.token)).paymentStatus,result.body.status);
  assert.equal((await f.store.read(f.token)).fulfillment,undefined);assert.equal(await stock(f),5);
 }
});
test('missing ciphertext and stock shortages preserve funds for manual reconciliation',async()=>{
 const missing=await fixture();
 assert.equal((await reconcileInvoice({...missing,escrow:{exists:async()=>false}})).body.status,'ESCROW_MISSING');
 assert.equal(await stock(missing),5);
 const f=await fixture();
 const row=await f.client.getEntity('invoices','stock:c1');
 await f.client.updateEntity({...row,quantity:1},'Replace',{etag:row.etag});
 assert.equal((await reconcileInvoice(f)).body.status,'SETTLEMENT_PENDING');
 assert.equal((await f.store.read(f.token)).committed,false);
 assert.equal((await f.store.read(f.token)).fulfillment,undefined);
});
test('reorg or provider failure holds queued work and recovery does not deduct stock again',async()=>{
 const f=await fixture();await reconcileInvoice(f);
 const reorg=await reconcileInvoice({...f,observe:async()=>({...paid,status:'CONFIRMING',eligibleSats:0})});
 assert.equal(reorg.body.status,'REORG_REVIEW');
 assert.equal((await f.store.read(f.token)).fulfillment.status,'ON_HOLD');
 await reconcileInvoice({...f,observe:async()=>{throw Error('down');}});
 assert.equal((await f.store.read(f.token)).fulfillment.status,'ON_HOLD');
 await reconcileInvoice(f);
 assert.equal((await f.store.read(f.token)).fulfillment.status,'PENDING');assert.equal(await stock(f),3);
});
test('legacy invoices are never automatically queued, including previously committed ones',async()=>{
 const pending=await fixture({addressAllocationVersion:undefined});
 assert.equal((await reconcileInvoice(pending)).body.error,'legacy_invoice_requires_review');
 const committed=await fixture({addressAllocationVersion:undefined,committed:true,settledSats:50000});
 assert.equal((await reconcileInvoice(committed)).body.fulfillmentStatus,'MANUAL_REVIEW');
 assert.equal((await committed.store.read(committed.token)).fulfillment,undefined);
});
test('a fallback alone or two URLs on the same origin cannot authorize settlement',async()=>{
 const f=await fixture();let calls=0;
 assert.equal((await reconcileInvoice({...f,providers:['https://same.example/api','https://same.example/other'],
  observe:async()=>{calls++;return paid;}})).body.error,'independent_provider_required');
 assert.equal(calls,0);
 const result=await reconcileInvoice({...f,providers:['https://a.example/api','https://b.example/api'],
  observe:async({baseUrl})=>{if(baseUrl.includes('a.example'))throw Error('down');return paid;}});
 assert.equal(result.body.error,'independent_provider_required');assert.equal(await stock(f),5);
});
test('persisted scan progress survives restart and a failing first invoice does not starve later ones',async()=>{
 const {store,client}=paymentTable();
 const tokens=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 for(const token of tokens)await store.create({token,address:'example',amountSats:1});
 await client.createEntity({partitionKey:'invoices',rowKey:'catalog:v1',payload:'[]'});
 const seen=[];
 const reconcile=async({token})=>{seen.push(token);if(token===tokens[0])throw Error('down');return {code:200,body:{paid:true}};};
 await processPaymentBatch({store,reconcile,batchSize:1});
 await processPaymentBatch({store:new AzureInvoiceStore(client),reconcile,batchSize:1});
 assert.deepEqual(seen,tokens);
 await processPaymentBatch({store,reconcile,batchSize:1}); // Skip catalog row and wrap.
 await processPaymentBatch({store,reconcile,batchSize:1});
 assert.equal(seen.at(-1),tokens[0]);
});
test('a failed scan checkpoint repeats the page safely on restart',async()=>{
 const f=await fixture();const checkpoint=f.store.savePaymentScanCursor.bind(f.store);
 f.store.savePaymentScanCursor=async()=>{throw Error('checkpoint_down');};
 await assert.rejects(()=>processPaymentBatch(f),/checkpoint_down/);
 assert.equal((await f.store.read(f.token)).fulfillment.status,'PENDING');
 f.store.savePaymentScanCursor=checkpoint;
 await processPaymentBatch(f);assert.equal(await stock(f),3);
});

test('empty Azure pages retain their continuation token across a restart',async()=>{
 const {store,client}=paymentTable();
 client.listEntities=()=>({byPage:()=> (async function*(){
  const page=[];page.continuationToken='opaque-next-page';yield page;
 })()});
 await processPaymentBatch({store});
 const restarted=new AzureInvoiceStore(client);
 assert.equal((await restarted.readPaymentScanCursor()).continuationToken,'opaque-next-page');
 let supplied;
 client.listEntities=()=>({byPage:options=> (async function*(){supplied=options.continuationToken;yield [];})()});
 await processPaymentBatch({store:restarted});
 assert.equal(supplied,'opaque-next-page');
 assert.equal((await restarted.readPaymentScanCursor()).continuationToken,'');
});
