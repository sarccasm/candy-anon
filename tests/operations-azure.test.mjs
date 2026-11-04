import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';
import {readCheckoutPolicy} from '../edge/lib/checkout-policy.mjs';
import {settleInvoiceAtomically} from '../edge/lib/atomic-settlement.mjs';
import {performOrderAction,orderReference,orderAudit} from '../edge/lib/admin-operations.mjs';
import {reconcileInvoice} from '../edge/lib/payment-processing.mjs';
import {updateCheckoutPolicy} from '../edge/lib/checkout-operations.mjs';
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {TableClient}=require('@azure/data-tables');
const connection=process.env.AZURITE_TABLE_CONNECTION_STRING;

test('real Azure reservations, audited manual handoff and checkout stop remain atomic', {skip:!connection},async()=>{
 const table='T'+randomUUID().replaceAll('-','').slice(0,22),client=TableClient.fromConnectionString(connection,table,{allowInsecureConnection:true});
 await client.createTable();
 try {
  const store=new AzureInvoiceStore(client);
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity:1});
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:c2',quantity:5});
  await client.createEntity({partitionKey:'invoices',rowKey:'checkout:policy',enabled:true,revision:0,
   usdPerBtc:70000,quoteUpdatedAt:new Date().toISOString(),quoteMaxAgeSeconds:900,maxInvoicesPerMinute:30});
  const policy=await readCheckoutPolicy(client);
  const invoices=Array.from({length:2},()=>({token:randomUUID(),address:'bcrt1'+randomUUID().replaceAll('-',''),
   amountSats:5000,items:{c1:1},createdAt:new Date().toISOString(),committed:false,addressAllocationVersion:1}));
  const results=await Promise.allSettled(invoices.map(invoice=>store.createWithUniqueAddress(invoice,{reserveStock:true,policy})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const winner=invoices[results.findIndex(result=>result.status==='fulfilled')];
  assert.equal((await client.getEntity('invoices','stock:c1')).reserved,1);
  await settleInvoiceAtomically(store,winner.token,{status:'PAID',eligibleSats:5000});
  const stock=await client.getEntity('invoices','stock:c1');assert.equal(stock.quantity,0);assert.equal(stock.reserved,0);
  const args={store,escrow:{exists:async()=>true,read:async()=>'-----BEGIN PGP MESSAGE-----\nENCRYPTED TEST DATA\n-----END PGP MESSAGE-----'},
   reference:orderReference(winner.token),actorKey:'test-admin-key-01234567890123456789',
   reconcile:values=>reconcileInvoice({...values,observe:async()=>({status:'PAID',eligibleSats:5000,receivedSats:5000,confirmations:2})})};
  const prepare={action:'prepare_handoff',version:0,requestId:randomUUID()};
  await performOrderAction({...args,body:prepare});
  assert.equal((await performOrderAction({...args,body:prepare})).duplicate,true);
  await performOrderAction({...args,body:{action:'acknowledge_handoff',version:1,requestId:randomUUID(),confirmed:true,receiptReference:'AZURITE-RECEIPT-001'}});
  assert.equal((await store.read(winner.token)).fulfillment.status,'FULFILLED');
  assert.equal((await orderAudit(store,args.reference)).length,2);
  await updateCheckoutPolicy({client,actorKey:args.actorKey,body:{action:'set_enabled',enabled:false,version:0,requestId:randomUUID()}});
  const other={...winner,token:randomUUID(),address:'bcrt1newaddress',items:{c2:1}};
  await assert.rejects(()=>store.createWithUniqueAddress(other,{reserveStock:true,policy}));
  assert.equal(await store.read(other.token),null);assert.equal((await client.getEntity('invoices','stock:c2')).reserved,undefined);
 } finally {await client.deleteTable();}
});
