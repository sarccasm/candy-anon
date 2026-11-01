import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryTemporaryStore } from '../edge/lib/temporary-store.mjs';
import { reconcileOrder } from '../edge/lib/order-reconciliation.mjs';
const created = async (store, status='PENDING')=>store.create({
  status, address:'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', amountSats:50000,
  expiresAt:Date.now()+60000
},{expiresAt:Date.now()+60000});
test('settles observed payment state only once',async()=>{
  const store=new MemoryTemporaryStore();const row=await created(store);
  const observer=async()=>({status:'PAID',receivedSats:50000});
  assert.equal((await reconcileOrder({store,id:row.id,observer})).status,'UPDATED');
  assert.equal((await reconcileOrder({store,id:row.id,observer})).status,'NO_CHANGE');
  assert.equal((await store.read(row.id)).paymentVerified,true);
});
test('late BTC never silently becomes paid',async()=>{
  const store=new MemoryTemporaryStore();const row=await created(store,'EXPIRED');
  const result=await reconcileOrder({store,id:row.id,observer:async()=>({status:'PAID',receivedSats:50000})});
  assert.equal(result.state,'LATE_PAYMENT');
});
test('provider errors never mutate order state',async()=>{
  const store=new MemoryTemporaryStore();const row=await created(store);
  await assert.rejects(()=>reconcileOrder({store,id:row.id,observer:async()=>{throw Error('provider_down')}}),/provider_down/);
  assert.equal((await store.read(row.id)).version,1);
});
test('conflict retry obtains a new observation',async()=>{
  const base=new MemoryTemporaryStore();const row=await created(base);let calls=0,conflicted=false;
  const store={
    read:(id)=>base.read(id),
    compareAndSwap:async(id,v,fn)=>{
      if(!conflicted){conflicted=true;throw Error('version_conflict');}
      return base.compareAndSwap(id,v,fn);
    }
  };
  const result=await reconcileOrder({store,id:row.id,observer:async()=>{calls++;return {status:'CONFIRMING',receivedSats:50000}}});
  assert.equal(result.status,'UPDATED');assert.equal(calls,2);
});
