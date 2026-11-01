import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBitcoinPayments, fetchFirstEsploraPage } from '../edge/lib/btc-reconciliation.mjs';

const addr='bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const tx=(digit, value, confirmed, height=100)=>({
  txid: digit.repeat(64), vout:[{scriptpubkey_address:addr,value}],
  status:{confirmed,...(confirmed?{block_height:height}:{})}
});
const check=(transactions,other={})=>inspectBitcoinPayments({
  address:addr, expectedSats:50000, transactions, tipHeight:101,
  requiredConfirmations:2, completeHistory:true, ...other
});

test('distinguishes partial, unconfirmed, and sufficiently confirmed BTC',()=>{
  assert.equal(check([]).status,'PENDING');
  assert.equal(check([tx('a',25000,true)]).status,'PARTIALLY_PAID');
  assert.equal(check([tx('a',50000,false)]).status,'CONFIRMING');
  assert.equal(check([tx('a',30000,true),tx('b',20000,true)]).status,'PAID');
  assert.equal(check([tx('a',50000,true,101)]).status,'CONFIRMING');
  assert.equal(check([tx('a',50000,true)],{expired:true}).status,'LATE_PAYMENT');
});
test('rejects incomplete history and duplicate transaction results',()=>{
  assert.throws(()=>check([tx('a',50000,true)],{completeHistory:false}),/unverifiable/);
  assert.throws(()=>check([tx('a',30000,true),tx('a',30000,true)]),/duplicate/);
  assert.throws(()=>check([tx('a',50000,true,105)]),/height/);
});
test('provider page does not claim completeness or payment', async()=>{
  const page=await fetchFirstEsploraPage({address:addr,baseUrl:'https://example.org/api',
    fetchImpl:async()=>({ok:true,json:async()=>[tx('a',50000,true)]})});
  assert.equal(page.completeHistory,false);
  assert.throws(()=>check(page.transactions,{completeHistory:page.completeHistory}),/unverifiable/);
});
