import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {reconcileLegacyInvoice} from '../edge/lib/legacy-reconciliation.mjs';
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const bitcoin=require('bitcoinjs-lib');
const invoice={token:'12345678-1234-4234-8234-123456789abc',
 address:bitcoin.payments.p2wpkh({hash:Buffer.alloc(20,1)}).address,amountSats:50000,committed:false};
const empty={status:'PENDING',receivedSats:0,confirmedSats:0,unconfirmedSats:0,eligibleSats:0,confirmations:0};
test('legacy reporting is offline unless explicitly enabled and never exposes address or token',async()=>{
 let calls=0;const result=await reconcileLegacyInvoice({invoice,observe:async()=>{calls++;return empty;}});
 assert.equal(calls,0);assert.equal(result.status,'NOT_CHECKED_ON_CHAIN');
 assert.equal(JSON.stringify(result).includes(invoice.token),false);assert.equal(JSON.stringify(result).includes(invoice.address),false);
});
test('two complete zero observations establish a snapshot without mutating the invoice',async()=>{
 const before=structuredClone(invoice);
 const result=await reconcileLegacyInvoice({invoice,network:true,observe:async()=>empty});
 assert.equal(result.status,'NO_FUNDS_OBSERVED');assert.equal(result.providers.length,2);assert.equal(result.mutated,false);assert.deepEqual(invoice,before);
});
test('provider outages, malformed observations and disagreements cannot look unpaid',async()=>{
 for(const observe of [async()=>{throw Error('private address URL');},async()=>({receivedSats:0}),
  async({baseUrl})=>baseUrl.includes('blockstream')?empty:{...empty,status:'PARTIALLY_PAID',receivedSats:1,unconfirmedSats:1}]){
  const result=await reconcileLegacyInvoice({invoice,network:true,observe});
  assert.notEqual(result.status,'NO_FUNDS_OBSERVED');assert.equal(JSON.stringify(result).includes('private address URL'),false);
 }
});
test('funded or reused legacy addresses always require manual attribution',async()=>{
 const paid={status:'PAID',receivedSats:50000,confirmedSats:50000,unconfirmedSats:0,eligibleSats:50000,confirmations:2};
 assert.equal((await reconcileLegacyInvoice({invoice,network:true,observe:async()=>paid})).status,'FUNDED_LEGACY_REQUIRES_REVIEW');
 assert.equal((await reconcileLegacyInvoice({invoice,network:true,observe:async()=>paid,historicalInvoiceCount:2})).status,'ADDRESS_REUSE_REQUIRES_REVIEW');
});
test('test-network addresses never leak to the mainnet providers',async()=>{
 const address=bitcoin.payments.p2wpkh({hash:Buffer.alloc(20,1),network:bitcoin.networks.regtest}).address;
 let calls=0;const result=await reconcileLegacyInvoice({invoice:{...invoice,address},network:true,observe:async()=>{calls++;return empty;}});
 assert.equal(result.status,'INVALID_INVOICE_OR_NETWORK');assert.equal(calls,0);
});
