import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBitcoinPayments} from '../edge/lib/btc-reconciliation.mjs';
const address='bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const base={address,expectedSats:50000,tipHeight:102,requiredConfirmations:2,completeHistory:true};
const transaction=(id,value,height)=>({txid:id.repeat(64),status:{confirmed:true,block_height:height},
  vout:[{scriptpubkey_address:address,value}]});
test('confirmed BTC paid only with adequate amount and confirmations',()=>{
  assert.equal(inspectBitcoinPayments({...base,transactions:[transaction('a',50000,100)]}).status,'PAID');
  assert.equal(inspectBitcoinPayments({...base,transactions:[transaction('a',50000,102)]}).status,'CONFIRMING');
  assert.equal(inspectBitcoinPayments({...base,transactions:[transaction('a',10000,100)]}).status,'PARTIALLY_PAID');
});
test('rejects incomplete transaction history and duplicate txids',()=>{
  const tx=transaction('a',50000,100);
  assert.throws(()=>inspectBitcoinPayments({...base,completeHistory:false,transactions:[tx]}),/unverifiable_payment_history/);
  assert.throws(()=>inspectBitcoinPayments({...base,transactions:[tx,tx]}),/invalid_or_duplicate_transaction/);
});
test('expired payments require review rather than automatic settlement',()=>{
  assert.equal(inspectBitcoinPayments({...base,expired:true,transactions:[transaction('a',50000,100)]}).status,'LATE_PAYMENT');
});
