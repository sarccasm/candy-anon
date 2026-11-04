import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateInvoiceSats} from '../edge/lib/btc-pricing.mjs';
test('converts positive USD values into safe satoshis',()=>{
 assert.equal(calculateInvoiceSats(20,100000,500),20000);
 assert.throws(()=>calculateInvoiceSats(0.01,100000,500),/below_minimum_btc_amount/);
});
test('rejects unsafe configuration, zero amounts and overflow',()=>{
 for(const args of [[20,0,500],[20,NaN,500],[20,100000,Infinity],
 [20,100000,-1],[0,100000,500],[1e20,1,500],[20,100000,2.5]]){
  assert.throws(()=>calculateInvoiceSats(...args),/invalid_btc/);
 }
});
