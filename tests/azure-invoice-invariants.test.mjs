import test from 'node:test';
import assert from 'node:assert/strict';
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';

const token='12345678-1234-4234-8234-123456789abc';
function fakeClient(){
  const rows=new Map();let seq=0;
  return {
    async createEntity(row){if(rows.has(row.rowKey))throw {statusCode:409};rows.set(row.rowKey,{...row,etag:String(++seq)});},
    async getEntity(_,key){const row=rows.get(key);if(!row)throw {statusCode:404};return {...row};},
    async updateEntity(row,mode,opts){const old=rows.get(row.rowKey);
      if(!old||old.etag!==opts.etag)throw {statusCode:412};
      assert.equal(mode,'Replace');rows.set(row.rowKey,{...row,etag:String(++seq)});}
  };
}
async function fixture(){
 const store=new AzureInvoiceStore(fakeClient());
 await store.create({token,address:'bc1testaddress1234567890123456',amountSats:50000,
  createdAt:'2026-11-01T00:00:00Z',items:{c1:2},committed:false});
 return store;
}
test('CAS allows nonfinancial status metadata',async()=>{
 const store=await fixture(),row=await store.read(token);
 const next=await store.compareAndSwap(token,row._etag,old=>({...old,status:'CONFIRMING'}));
 assert.equal(next.status,'CONFIRMING');
});
test('CAS rejects tampering with immutable invoice fields',async()=>{
 for(const patch of [{createdAt:'2020-01-01T00:00:00Z'},
  {items:{c1:1}},{committed:true},{settledSats:50000},{address:'bc1differentaddress1234567890'},
  {amountSats:1},{addressAllocationVersion:1},{addressIndex:0},{addressBranch:1}]){
  const store=await fixture(),row=await store.read(token);
  await assert.rejects(()=>store.compareAndSwap(token,row._etag,old=>({...old,...patch})),/invalid_update/);
  const unchanged=await store.read(token);
  assert.equal(unchanged.committed,false);
  assert.equal(unchanged.amountSats,50000);
 }
});
