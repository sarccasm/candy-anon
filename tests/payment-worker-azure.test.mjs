import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';
import {processPaymentBatch} from '../edge/lib/payment-worker.mjs';
import {reconcileInvoice} from '../edge/lib/payment-processing.mjs';
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {TableClient}=require('@azure/data-tables');
const connection=process.env.AZURITE_TABLE_CONNECTION_STRING;
const paid={status:'PAID',eligibleSats:50000,receivedSats:50000,confirmations:2};

test('real Azure worker resumes pages, settles without a browser, and holds a reorg', {skip:!connection},async()=>{
 const table='T'+randomUUID().replaceAll('-','').slice(0,22);
 const client=TableClient.fromConnectionString(connection,table,{allowInsecureConnection:true});
 await client.createTable();
 try {
  const store=new AzureInvoiceStore(client);
  const tokens=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity:10});
  for(const token of tokens)await store.createWithUniqueAddress({token,address:'bc1test'+token.replaceAll('-',''),
   amountSats:50000,items:{c1:2},createdAt:new Date().toISOString(),committed:false,addressAllocationVersion:1});
  const dependencies={escrow:{exists:async()=>true},observe:async()=>paid,batchSize:1};
  await processPaymentBatch({...dependencies,store});
  assert.equal((await store.read(tokens[0])).fulfillment.status,'PENDING');
  assert.equal((await store.read(tokens[1])).committed,false);
  const restarted=new AzureInvoiceStore(client);
  await processPaymentBatch({...dependencies,store:restarted});
  assert.equal((await restarted.read(tokens[1])).fulfillment.status,'PENDING');
  assert.equal((await client.getEntity('invoices','stock:c1')).quantity,6);
  const result=await reconcileInvoice({...dependencies,store:restarted,token:tokens[0],
   observe:async()=>({...paid,status:'CONFIRMING',eligibleSats:0})});
  assert.equal(result.body.status,'REORG_REVIEW');
  assert.equal((await store.read(tokens[0])).fulfillment.status,'ON_HOLD');
  await reconcileInvoice({...dependencies,store,token:tokens[0]});
  assert.equal((await store.read(tokens[0])).fulfillment.status,'PENDING');
  assert.equal((await client.getEntity('invoices','stock:c1')).quantity,6);
 } finally {await client.deleteTable();}
});
