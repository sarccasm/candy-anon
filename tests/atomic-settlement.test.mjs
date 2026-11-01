import test from 'node:test';
import assert from 'node:assert/strict';
import { AzureInvoiceStore } from '../edge/lib/azure-invoices.mjs';
import { settleInvoiceAtomically } from '../edge/lib/atomic-settlement.mjs';

const token='12345678-1234-4234-8234-123456789abc';
function fakeTable(){
  const rows=new Map();
  let revision=0;
  return {
    rows,
    async createEntity(row){const key=row.partitionKey+'/'+row.rowKey;if(rows.has(key))throw {statusCode:409};rows.set(key,{...row,etag:String(++revision)});},
    async getEntity(partition,row){const x=rows.get(partition+'/'+row);if(!x)throw {statusCode:404};return {...x};},
    async updateEntity(){throw Error('unexpected_direct_update')},
    async submitTransaction(actions){
      const changes=[];
      for(const [kind,entity,mode,opts] of actions){
        assert.equal(kind,'update');assert.equal(mode,'Replace');
        const key=entity.partitionKey+'/'+entity.rowKey;
        const before=rows.get(key);
        if(!before||before.etag!==opts.etag)throw {statusCode:412};
        changes.push([key,{...entity,etag:String(++revision)}]);
      }
      for(const [key,updated] of changes)rows.set(key,updated);
    }
  };
}
async function setup(){
  const client=fakeTable(),store=new AzureInvoiceStore(client);
  await store.create({token,address:'bc1sampleaddress1234567890',amountSats:50000,
    createdAt:new Date().toISOString(),items:{c1:2},committed:false});
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity:5});
  return {store,client};
}
const paid={status:'PAID',eligibleSats:50000};
test('atomic payment and stock settlement is idempotent',async()=>{
  const {store,client}=await setup();
  assert.deepEqual(await settleInvoiceAtomically(store,token,paid),{ok:true,alreadyCommitted:false});
  assert.equal((await store.read(token)).committed,true);
  assert.equal((await client.getEntity('invoices','stock:c1')).quantity,3);
  assert.deepEqual(await settleInvoiceAtomically(store,token,paid),{ok:true,alreadyCommitted:true});
  assert.equal((await client.getEntity('invoices','stock:c1')).quantity,3);
});
test('underpayment and absent stock do not settle',async()=>{
  const {store,client}=await setup();
  await assert.rejects(()=>settleInvoiceAtomically(store,token,{status:'CONFIRMING',eligibleSats:50000}),/unverified/);
  await assert.rejects(()=>settleInvoiceAtomically(store,token,{status:'PAID',eligibleSats:100}),/underfunded/);
  client.rows.delete('invoices/stock:c1');
  await assert.rejects(()=>settleInvoiceAtomically(store,token,paid),/inventory_not_provisioned/);
  assert.equal((await store.read(token)).committed,false);
});
test('stock shortages do not modify invoices or inventory',async()=>{
  const {store,client}=await setup();
  const stock=await client.getEntity('invoices','stock:c1');
  client.rows.set('invoices/stock:c1',{...stock,quantity:1});
  await assert.rejects(()=>settleInvoiceAtomically(store,token,paid),/out_of_stock/);
  assert.equal((await store.read(token)).committed,false);
});

test('ETag collision leaves invoice uncommitted until a fresh retry',async()=>{
  const {store,client}=await setup();
  client.submitTransaction=async()=>{throw {statusCode:412};};
  await assert.rejects(()=>settleInvoiceAtomically(store,token,paid),/settlement_conflict_retry/);
  assert.equal((await store.read(token)).committed,false);
  assert.equal((await client.getEntity('invoices','stock:c1')).quantity,5);
});
test('never commits an expired quote',async()=>{
  const {store,client}=await setup();
  const record=await store.read(token);
  const key='invoices/'+token;
  const raw=client.rows.get(key);
  client.rows.set(key,{...raw,payload:JSON.stringify({...JSON.parse(raw.payload),createdAt:'2001-01-01T00:00:00Z'})});
  await assert.rejects(()=>settleInvoiceAtomically(store,token,paid),/late_payment_manual_review/);
  assert.equal((await client.getEntity('invoices','stock:c1')).quantity,5);
});

test('rejects more than 50 SKU updates per atomic settlement',async()=>{
  const {store,client}=await setup();
  const key='invoices/'+token;
  const original=client.rows.get(key);
  const many=Object.fromEntries(Array.from({length:51},(_,i)=>['c'+i,1]));
  client.rows.set(key,{...original,payload:JSON.stringify({...JSON.parse(original.payload),items:many})});
  await assert.rejects(()=>settleInvoiceAtomically(store,token,paid),/invalid_items/);
});
