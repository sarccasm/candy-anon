import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {TableClient}=require('@azure/data-tables');
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';
import {settleInvoiceAtomically} from '../edge/lib/atomic-settlement.mjs';

const connection=process.env.AZURITE_TABLE_CONNECTION_STRING;
test('real Azure Table SDK transactions are atomic and idempotent', {skip:!connection},async()=>{
 const table='T'+randomUUID().replaceAll('-','').slice(0,22);
 const client=TableClient.fromConnectionString(connection,table);
 await client.createTable();
 try{
  const store=new AzureInvoiceStore(client);
  const token=randomUUID();
  await store.create({token,address:'bc1qexampleaddress01234567890',amountSats:50000,
    items:{candy:2},createdAt:new Date().toISOString(),committed:false});
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:candy',quantity:5,warehouse:'test'});
  const paid={status:'PAID',eligibleSats:50000};
  assert.deepEqual(await settleInvoiceAtomically(store,token,paid),{ok:true,alreadyCommitted:false});
  assert.equal((await store.read(token)).committed,true);
  assert.equal((await client.getEntity('invoices','stock:candy')).quantity,3);
  assert.equal((await client.getEntity('invoices','stock:candy')).warehouse,'test');
  assert.deepEqual(await settleInvoiceAtomically(store,token,paid),{ok:true,alreadyCommitted:true});
  assert.equal((await client.getEntity('invoices','stock:candy')).quantity,3);
 }finally{await client.deleteTable();}
});

test('Azure Table rejects stale ETag batch without partially changing stock', {skip:!connection},async()=>{
 const table='T'+randomUUID().replaceAll('-','').slice(0,22);
 const client=TableClient.fromConnectionString(connection,table);
 await client.createTable();
 try {
  const store=new AzureInvoiceStore(client);
  const token=randomUUID();
  await store.create({token,address:'bc1qexampleaddress01234567890',amountSats:50000,
    items:{candy:2},createdAt:new Date().toISOString(),committed:false});
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:candy',quantity:5});
  const originalSubmit=client.submitTransaction.bind(client);
  client.submitTransaction=async actions=>{
    await client.updateEntity({partitionKey:'invoices',rowKey:'stock:candy',quantity:4},'Replace');
    return originalSubmit(actions);
  };
  await assert.rejects(()=>settleInvoiceAtomically(store,token,
    {status:'PAID',eligibleSats:50000}),/settlement_conflict_retry/);
  assert.equal((await store.read(token)).committed,false);
  assert.equal((await client.getEntity('invoices','stock:candy')).quantity,4);
 } finally {await client.deleteTable();}
});
