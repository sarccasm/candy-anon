import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {migrateDataset} from '../edge/lib/dataset-migration.mjs';
import {legacyReference,legacyInvoiceDigest,legacyProviders} from '../edge/lib/legacy-reconciliation.mjs';
import {paymentTable} from './helpers/payment-table.mjs';
const require=createRequire(new URL('../edge/package.json',import.meta.url)),bitcoin=require('bitcoinjs-lib');
function source(){
 const invoice={token:randomUUID(),address:bitcoin.payments.p2wpkh({hash:Buffer.alloc(20,1)}).address,
  amountSats:50000,amountUsd:3.5,createdAt:'2025-12-01T00:00:00Z',items:{c1:1},committed:false};
 return {state:{products:[{id:'c1',name:'Candy',price:3.5,tags:[],color:''}]},inventory:{c1:8},invoices:[invoice],
  evidence:{networkUsed:true,readOnly:true,checkedAt:new Date().toISOString(),results:[{
   reference:legacyReference(invoice.token),sourceDigest:legacyInvoiceDigest(invoice),status:'NO_FUNDS_OBSERVED',
   providers:legacyProviders.map(source=>({source,verified:true,receivedSats:0,eligibleSats:0}))}]}};
}
async function target(){
 const f=paymentTable();await f.client.createEntity({partitionKey:'invoices',rowKey:'checkout:policy',enabled:false,revision:0,
  usdPerBtc:70000,quoteUpdatedAt:new Date().toISOString(),quoteMaxAgeSeconds:900,maxInvoicesPerMinute:30});return f;
}
test('combined dataset migration defaults to an offline plan',async()=>{
 const result=await migrateDataset(source());assert.equal(result.dryRun,true);assert.equal(result.freshLegacyEvidence,true);assert.equal(result.legacyInvoices,1);
});
test('migration imports technical metadata atomically, leaves checkout stopped and never promotes legacy payment',async()=>{
 const f=await target(),data=source(),result=await migrateDataset({...data,client:f.client,apply:true});
 assert.equal(result.replayed,false);assert.equal((await f.client.getEntity('invoices','checkout:policy')).enabled,false);
 assert.equal((await f.client.getEntity('invoices','stock:c1')).quantity,8);
 const invoice=await f.store.read(data.invoices[0].token);assert.equal(invoice.committed,false);assert.equal(invoice.addressAllocationVersion,undefined);
 assert.equal(invoice.paymentStatus,'INVOICE_REVIEW');assert.equal(invoice.review.state,'OPEN');assert.equal(invoice.reservation,undefined);
 const row=await f.client.getEntity('invoices','stock:c1');await f.client.updateEntity({...row,quantity:7},'Replace',{etag:row.etag});
 const replay=await migrateDataset({...data,client:f.client,apply:true});assert.equal(replay.replayed,true);
 assert.equal((await f.client.getEntity('invoices','stock:c1')).quantity,7);
});
test('an existing target row aborts the entire migration without partial catalog or invoices',async()=>{
 const f=await target(),data=source();await f.client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity:2});
 await assert.rejects(()=>migrateDataset({...data,client:f.client,apply:true}));
 await assert.rejects(()=>f.client.getEntity('invoices','catalog:v1'));assert.equal(await f.store.read(data.invoices[0].token),null);
 assert.equal((await f.client.getEntity('invoices','stock:c1')).quantity,2);
});
test('live checkout, stale evidence and changed source invoices block application',async()=>{
 const f=await target(),data=source();
 const row=await f.client.getEntity('invoices','checkout:policy');await f.client.updateEntity({...row,enabled:true},'Replace',{etag:row.etag});
 await assert.rejects(()=>migrateDataset({...data,client:f.client,apply:true}),/checkout_must_be_stopped/);
 const stale=source();stale.evidence.checkedAt='2025-01-01T00:00:00Z';
 await assert.rejects(()=>migrateDataset({...stale,client:f.client,apply:true}),/fresh_legacy_verification_required/);
 const changed=source();changed.invoices[0].amountSats++;
 await assert.rejects(()=>migrateDataset({...changed,client:f.client,apply:true}),/fresh_legacy_verification_required/);
});
