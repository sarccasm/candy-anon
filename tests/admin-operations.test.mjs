import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentTable} from './helpers/payment-table.mjs';
import {performOrderAction,orderReference,resolveOrder} from '../edge/lib/admin-operations.mjs';
import {reconcileInvoice} from '../edge/lib/payment-processing.mjs';
import {updateCheckoutPolicy} from '../edge/lib/checkout-operations.mjs';
import {readCheckoutPolicy,assertCheckoutOpen} from '../edge/lib/checkout-policy.mjs';

const paid={status:'PAID',eligibleSats:5000,receivedSats:5000,confirmations:2};
const actorKey='test-operator-key-0123456789';
async function fixture(){
 const f=paymentTable(),token=randomUUID(),reference=orderReference(token);
 await f.store.create({token,address:'bcrt1example',amountSats:5000,settledSats:5000,committed:true,
  addressAllocationVersion:1,createdAt:new Date().toISOString(),committedAt:new Date().toISOString(),
  paymentStatus:'PAID',items:{c1:1},fulfillment:{status:'PENDING',idempotencyKey:token,encryptedBlob:token+'.asc'}});
 await f.client.createEntity({partitionKey:'invoices',rowKey:'order:'+reference,token});
 return {...f,token,reference,actorKey,escrow:{exists:async()=>true,read:async()=> '-----BEGIN PGP MESSAGE-----\nENCRYPTED ONLY\n-----END PGP MESSAGE-----'},
  reconcile:args=>reconcileInvoice({...args,observe:async()=>paid})};
}
const action=(name,version=0,extra={})=>({action:name,version,requestId:randomUUID(),...extra});
test('manual preparation and acknowledgement are atomic, audited and idempotent',async()=>{
 const f=await fixture(),prepare=action('prepare_handoff');
 const first=await performOrderAction({...f,body:prepare});
 assert.equal(first.order.fulfillmentStatus,'HANDOFF_READY');assert.match(first.ciphertext,/BEGIN PGP MESSAGE/);
 const duplicate=await performOrderAction({...f,body:prepare});assert.equal(duplicate.duplicate,true);
 await assert.rejects(()=>performOrderAction({...f,body:action('prepare_handoff',1)}),/already_prepared/);
 const ack=action('acknowledge_handoff',1,{confirmed:true,receiptReference:'RECEIPT-TEST-001'});
 const result=await performOrderAction({...f,body:ack});assert.equal(result.order.fulfillmentStatus,'FULFILLED');
 assert.equal((await performOrderAction({...f,body:ack})).duplicate,true);
 const stored=await f.store.read(f.token);assert.equal(stored.fulfillment.receiptHash.length,64);
 assert.equal(JSON.stringify([...f.client.rows.values()]).includes('RECEIPT-TEST-001'),false);
 assert.equal([...f.client.rows.values()].filter(row=>row.rowKey.startsWith('ops-audit:')).length,2);
 await f.reconcile({store:f.store,escrow:f.escrow,token:f.token});
 assert.equal((await f.store.read(f.token)).fulfillment.status,'FULFILLED');
});
test('reorgs prevent data release and cannot undo already acknowledged handoff',async()=>{
 const f=await fixture();
 const reorg=args=>reconcileInvoice({...args,observe:async()=>({...paid,status:'CONFIRMING',eligibleSats:0})});
 await assert.rejects(()=>performOrderAction({...f,reconcile:reorg,body:action('prepare_handoff')}),/payment_requires_review/);
 assert.equal([...f.client.rows.values()].filter(row=>row.rowKey.startsWith('ops-audit:')).length,0);
});
test('operator review blocks handoff; closing never invents a payment',async()=>{
 const f=await fixture();await performOrderAction({...f,body:action('open_review',0,{category:'REFUND_REQUIRED'})});
 await assert.rejects(()=>performOrderAction({...f,body:action('prepare_handoff',1)}),/review_open/);
 const closed=await performOrderAction({...f,body:action('close_review',1,{reasonCode:'CHECKED'})});
 assert.equal(closed.order.review.state,'CLOSED');assert.equal(closed.order.fulfillmentStatus,'PENDING');
});
test('externally recorded refunds remain blocked through later reviews and payment scans',async()=>{
 const f=await fixture();await performOrderAction({...f,body:action('open_review',0,{category:'REFUND_REQUIRED'})});
 await performOrderAction({...f,body:action('close_review',1,{reasonCode:'REFUND_RECORDED_EXTERNALLY'})});
 await f.reconcile({store:f.store,escrow:f.escrow,token:f.token});
 await assert.rejects(()=>performOrderAction({...f,body:action('prepare_handoff',2)}),/review_open/);
 assert.equal((await f.store.read(f.token)).fulfillment.status,'ON_HOLD');
});
test('stale operators and conflicting retry IDs cannot overwrite actions',async()=>{
 const f=await fixture(),body=action('open_review',0,{category:'PAYMENT_CHECK'});
 await performOrderAction({...f,body});
 await assert.rejects(()=>performOrderAction({...f,body:{...body,category:'OTHER'}}),/idempotency_conflict/);
 await assert.rejects(()=>performOrderAction({...f,body:action('open_review',0,{category:'OTHER'})}),/operation_conflict/);
});
test('an audit storage failure prevents recording a handoff state',async()=>{
 const f=await fixture();f.client.submitTransaction=async()=>{throw Error('offline');};
 await assert.rejects(()=>performOrderAction({...f,body:action('prepare_handoff')}),/offline/);
 assert.equal((await f.store.read(f.token)).fulfillment.status,'PENDING');
});
test('reference lookup does not expose the original bearer token in operation results',async()=>{
 const f=await fixture();assert.equal((await resolveOrder(f.store,f.reference)).token,f.token);
 const result=await performOrderAction({...f,body:action('open_review',0,{category:'OTHER'})});
 assert.equal(JSON.stringify(result).includes(f.token),false);
 await assert.rejects(()=>performOrderAction({...f,body:action('close_review',1,{reasonCode:'free text with PII'})}),/invalid_reason/);
});
test('checkout stop, quote freshness and policy edits are durable and audited',async()=>{
 const f=paymentTable(),now=Date.now();
 await f.client.createEntity({partitionKey:'invoices',rowKey:'checkout:policy',enabled:true,revision:0,
  usdPerBtc:70000,quoteUpdatedAt:new Date(now).toISOString(),quoteMaxAgeSeconds:900,maxInvoicesPerMinute:30});
 const stop={action:'set_enabled',version:0,requestId:randomUUID(),enabled:false};
 await updateCheckoutPolicy({client:f.client,body:stop,actorKey,now});
 await assert.rejects(async()=>assertCheckoutOpen(await readCheckoutPolicy(f.client)),/checkout_disabled/);
 assert.equal((await updateCheckoutPolicy({client:f.client,body:stop,actorKey,now})).enabled,false);
 await assert.rejects(()=>updateCheckoutPolicy({client:f.client,body:{...stop,requestId:randomUUID(),enabled:true},actorKey,now}),/operation_conflict/);
 await assert.rejects(()=>updateCheckoutPolicy({client:f.client,body:{...stop,version:1,requestId:randomUUID(),enabled:true},actorKey,now:now+16*60000}),/btc_quote_expired/);
});

test('extraneous request fields never enter the audit log or invoice',async()=>{
 const f=await fixture();
 await performOrderAction({...f,body:action('prepare_handoff',0,{category:'PRIVATE CUSTOMER NAME',reasonCode:'PRIVATE PHONE'})});
 const serialized=JSON.stringify([...f.client.rows.values()]);
 assert.equal(serialized.includes('PRIVATE CUSTOMER NAME'),false);assert.equal(serialized.includes('PRIVATE PHONE'),false);
});
test('reorg after acknowledgement marks payment review without undoing manual handoff',async()=>{
 const f=await fixture();
 await performOrderAction({...f,body:action('prepare_handoff')});
 await performOrderAction({...f,body:action('acknowledge_handoff',1,{confirmed:true,receiptReference:'RECEIPT-TEST-002'})});
 await reconcileInvoice({store:f.store,escrow:f.escrow,token:f.token,observe:async()=>({...paid,status:'CONFIRMING',eligibleSats:0})});
 const invoice=await f.store.read(f.token);assert.equal(invoice.fulfillment.status,'FULFILLED');assert.equal(invoice.fulfillment.paymentHold,true);
});

test('policy bootstrap is dry-run, disabled and create-only',async()=>{
 const {initializeCheckout}=await import('../edge/scripts/initialize-checkout.mjs');
 const f=paymentTable();
 const plan=await initializeCheckout({usdPerBtc:70000});assert.equal(plan.dryRun,true);assert.equal(plan.policy.enabled,false);
 await initializeCheckout({client:f.client,usdPerBtc:70000,actorKey,apply:true});
 assert.equal((await readCheckoutPolicy(f.client)).enabled,false);
 await assert.rejects(()=>initializeCheckout({client:f.client,usdPerBtc:80000,actorKey,apply:true}));
 assert.equal((await readCheckoutPolicy(f.client)).usdPerBtc,70000);
});
