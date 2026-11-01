import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIndependentPayment} from '../edge/lib/independent-payment-check.mjs';
const paid={status:'PAID',eligibleSats:50000};
test('requires two independent sufficient BTC observations',()=>{
 assert.equal(verifyIndependentPayment(paid,paid,50000),true);
 assert.equal(verifyIndependentPayment(paid,{status:'CONFIRMING',eligibleSats:50000},50000),false);
 assert.equal(verifyIndependentPayment(paid,{status:'PAID',eligibleSats:49999},50000),false);
 assert.equal(verifyIndependentPayment(null,paid,50000),false);
 assert.equal(verifyIndependentPayment(paid,{status:'PAID',eligibleSats:NaN},50000),false);
});
test('invalid invoice amount does not permit paid status',()=>{
 assert.throws(()=>verifyIndependentPayment(paid,paid,0),/invalid_expected_amount/);
});
