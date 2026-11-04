import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentTable} from './helpers/payment-table.mjs';
import {availableStock,releaseUnpaidReservation} from '../edge/lib/stock-reservations.mjs';
import {readCheckoutPolicy} from '../edge/lib/checkout-policy.mjs';
import {settleInvoiceAtomically} from '../edge/lib/atomic-settlement.mjs';

async function fixture(quantity=1){
 const f=paymentTable();
 await f.client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity});
 await f.client.createEntity({partitionKey:'invoices',rowKey:'checkout:policy',enabled:true,revision:0,
  usdPerBtc:70000,quoteUpdatedAt:new Date().toISOString(),quoteMaxAgeSeconds:900,maxInvoicesPerMinute:30});
 f.policy=await readCheckoutPolicy(f.client);
 return f;
}
const invoice=(patch={})=>({token:randomUUID(),address:'bcrt1'+randomUUID().replaceAll('-',''),amountSats:5000,
 addressAllocationVersion:1,createdAt:new Date().toISOString(),items:{c1:1},committed:false,...patch});
const empty={status:'PENDING',eligibleSats:0,receivedSats:0};
test('two simultaneous invoices cannot reserve the last item twice',async()=>{
 const f=await fixture(),first=invoice(),second=invoice();
 const results=await Promise.allSettled([first,second].map(value=>f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const row=await f.client.getEntity('invoices','stock:c1');assert.equal(row.quantity,1);assert.equal(row.reserved,1);assert.equal(availableStock(row),0);
 assert.equal((await Promise.all([first,second].map(value=>f.store.read(value.token)))).filter(Boolean).length,1);
});
test('settlement consumes the reservation and physical quantity once',async()=>{
 const f=await fixture(),value=invoice();await f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy});
 await settleInvoiceAtomically(f.store,value.token,{status:'PAID',eligibleSats:5000});
 await settleInvoiceAtomically(f.store,value.token,{status:'PAID',eligibleSats:5000});
 const row=await f.client.getEntity('invoices','stock:c1');assert.equal(row.quantity,0);assert.equal(row.reserved,0);
 assert.equal((await f.store.read(value.token)).reservation.status,'CONSUMED');
});
test('expired unpaid reservations release atomically, once, without deleting invoices',async()=>{
 const f=await fixture(),value=invoice({createdAt:new Date(Date.now()-21*60000).toISOString()});
 await f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy});
 await releaseUnpaidReservation(f.store,value.token,[empty,empty]);
 await releaseUnpaidReservation(f.store,value.token,[empty,empty]);
 const row=await f.client.getEntity('invoices','stock:c1');assert.equal(row.quantity,1);assert.equal(row.reserved,0);
 assert.equal((await f.store.read(value.token)).reservation.status,'RELEASED');
 await assert.rejects(()=>settleInvoiceAtomically(f.store,value.token,{status:'PAID',eligibleSats:5000}));
});
test('partial, unconfirmed, early and unverifiable payments never release reserved stock',async()=>{
 const f=await fixture(),value=invoice();await f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy});
 await assert.rejects(()=>releaseUnpaidReservation(f.store,value.token,[empty,empty]),/not_expired/);
 for(const observed of [{...empty,receivedSats:1},{...empty,status:'CONFIRMING'},{...empty,eligibleSats:1},null])
  await assert.rejects(()=>releaseUnpaidReservation(f.store,value.token,[empty,observed]),/unpaid_not_verified/);
 assert.equal((await f.client.getEntity('invoices','stock:c1')).reserved,1);
});
test('legacy settlement cannot consume inventory reserved by another invoice',async()=>{
 const f=await fixture(),value=invoice();await f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy});
 const old=invoice();await f.store.create(old);
 await assert.rejects(()=>settleInvoiceAtomically(f.store,old.token,{status:'PAID',eligibleSats:5000}),/out_of_stock/);
});
test('a concurrent checkout stop invalidates invoice creation without leaving reservations',async()=>{
 const f=await fixture(),value=invoice();
 await f.client.updateEntity({...f.policy,enabled:false,revision:1},'Replace',{etag:f.policy.etag});
 await assert.rejects(()=>f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy}));
 assert.equal(await f.store.read(value.token),null);assert.equal((await f.client.getEntity('invoices','stock:c1')).reserved,undefined);
});

test('global admission quota rejects another invoice without another hold',async()=>{
 const f=await fixture(2);
 const current=await f.client.getEntity('invoices','checkout:policy');
 await f.client.updateEntity({...current,maxInvoicesPerMinute:1},'Replace',{etag:current.etag});
 f.policy=await readCheckoutPolicy(f.client);
 const first=invoice();await f.store.createWithUniqueAddress(first,{reserveStock:true,policy:f.policy});
 const second=invoice();const latest=await readCheckoutPolicy(f.client);
 await assert.rejects(()=>f.store.createWithUniqueAddress(second,{reserveStock:true,policy:latest}),/checkout_rate_limited/);
 assert.equal(await f.store.read(second.token),null);assert.equal((await f.client.getEntity('invoices','stock:c1')).reserved,1);
});

test('scheduled reconciliation retains a reservation on provider failure and releases only after both zero-fund checks',async()=>{
 const {reconcileInvoice}=await import('../edge/lib/payment-processing.mjs');
 const f=await fixture(),value=invoice({createdAt:new Date(Date.now()-21*60000).toISOString()});
 await f.store.createWithUniqueAddress(value,{reserveStock:true,policy:f.policy});
 const dependencies={store:f.store,escrow:{exists:async()=>true},token:value.token,
  providers:['https://first.example/api','https://second.example/api']};
 const failed=await reconcileInvoice({...dependencies,observe:async({baseUrl})=>{
  if(baseUrl.includes('second.example'))throw Error('offline');return empty;
 }});
 assert.equal(failed.body.status,'RESERVATION_RELEASE_PENDING');assert.equal((await f.client.getEntity('invoices','stock:c1')).reserved,1);
 const released=await reconcileInvoice({...dependencies,observe:async()=>empty});
 assert.equal(released.body.status,'EXPIRED');assert.equal((await f.client.getEntity('invoices','stock:c1')).reserved,0);
 assert.equal((await f.store.read(value.token)).reservation.status,'RELEASED');
});
