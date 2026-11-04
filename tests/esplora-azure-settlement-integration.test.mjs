import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';
import {observeBitcoinInvoice} from '../edge/lib/esplora-watcher.mjs';
import {verifyIndependentPayment} from '../edge/lib/independent-payment-check.mjs';
import {settleInvoiceAtomically} from '../edge/lib/atomic-settlement.mjs';

const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {TableClient}=require('@azure/data-tables');
const connection=process.env.AZURITE_TABLE_CONNECTION_STRING;
const address='bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const hash='a'.repeat(64);
const txid='b'.repeat(64);

function esploraFetch({confirmed=true,amount=50000,tipHeight=101}={}) {
 const payment={txid,vout:[{scriptpubkey_address:address,value:amount}],
   status:confirmed?{confirmed:true,block_height:100}:{confirmed:false}};
 return async function fetchImpl(url) {
  const path=new URL(url).pathname;
  const body=path.endsWith('/blocks/tip/hash')?hash
    :path.endsWith('/blocks/tip/height')?String(tipHeight)
    :path===`/api/address/${address}`?{chain_stats:{tx_count:confirmed?1:0}}
    :path===`/api/address/${address}/txs/mempool`?(confirmed?[]:[payment])
    :path===`/api/address/${address}/txs/chain`?(confirmed?[payment]:[])
    :undefined;
  if(body===undefined)throw Error('unexpected_esplora_route:'+path);
  return {ok:true,text:async()=>String(body),json:async()=>body};
 };
}
async function observe(baseUrl,fetchImpl) {
 return observeBitcoinInvoice({address,expectedSats:50000,
   requiredConfirmations:2,baseUrl,fetchImpl});
}
async function withTable(fn) {
 const table='T'+randomUUID().replaceAll('-','').slice(0,22);
 const client=TableClient.fromConnectionString(connection,table,{allowInsecureConnection:true});
 await client.createTable();
 try {
  const store=new AzureInvoiceStore(client);
  const token=randomUUID();
  await store.create({token,address,amountSats:50000,
   items:{candy:2},createdAt:new Date().toISOString(),committed:false});
  await client.createEntity({partitionKey:'invoices',rowKey:'stock:candy',quantity:5});
  await fn({client,store,token});
 } finally {await client.deleteTable();}
}
test('Esplora observations from two providers settle real Azure Table once',
 {skip:!connection},async()=>{
 await withTable(async({client,store,token})=>{
  const primary=await observe('https://primary.example/api',esploraFetch());
  const secondary=await observe('https://secondary.example/api',esploraFetch());
  assert.equal(primary.status,'PAID');
  assert.equal(verifyIndependentPayment(primary,secondary,50000),true);
  assert.deepEqual(await settleInvoiceAtomically(store,token,secondary),
   {ok:true,alreadyCommitted:false});
  assert.equal((await client.getEntity('invoices','stock:candy')).quantity,3);
  assert.deepEqual(await settleInvoiceAtomically(store,token,secondary),
   {ok:true,alreadyCommitted:true});
  assert.equal((await store.read(token)).settledSats,50000);
  assert.equal((await client.getEntity('invoices','stock:candy')).quantity,3);
 });
});
test('provider disagreement after block invalidation prevents Azure settlement',
 {skip:!connection},async()=>{
 await withTable(async({client,store,token})=>{
  const primary=await observe('https://primary.example/api',esploraFetch());
  const secondary=await observe('https://secondary.example/api',esploraFetch({confirmed:false}));
  assert.equal(primary.status,'PAID');
  assert.equal(secondary.status,'CONFIRMING');
  assert.equal(verifyIndependentPayment(primary,secondary,50000),false);
  assert.equal((await store.read(token)).committed,false);
  assert.equal((await client.getEntity('invoices','stock:candy')).quantity,5);
 });
});
