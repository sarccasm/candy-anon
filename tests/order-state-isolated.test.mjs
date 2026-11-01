import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderState, transition, classifyPayment } from '../edge/lib/order-state.mjs';

test('BTC payment classification',()=>{
  const base={amountSats:50000,requiredConfirmations:2};
  assert.equal(classifyPayment({...base,receivedSats:0,confirmations:0}),OrderState.PENDING);
  assert.equal(classifyPayment({...base,receivedSats:10000,confirmations:1}),OrderState.PARTIALLY_PAID);
  assert.equal(classifyPayment({...base,receivedSats:50000,confirmations:1}),OrderState.CONFIRMING);
  assert.equal(classifyPayment({...base,receivedSats:50000,confirmations:2}),OrderState.PAID);
  assert.equal(classifyPayment({...base,receivedSats:50000,confirmations:2,expired:true}),OrderState.LATE_PAYMENT);
});
test('fulfillment requires verified payment and acknowledgement',()=>{
  assert.throws(()=>transition({status:OrderState.PAID,paymentVerified:false},OrderState.FULFILLMENT_PENDING),/payment_not_verified/);
  const ready=transition({status:OrderState.PAID,paymentVerified:true},OrderState.FULFILLMENT_PENDING);
  assert.throws(()=>transition(ready,OrderState.FULFILLED),/fulfillment_not_acknowledged/);
  assert.equal(transition({...ready,fulfillmentAcknowledged:true},OrderState.FULFILLED).status,OrderState.FULFILLED);
});
test('expired quote is not automatically paid or fulfilled',()=>{
  const expired=transition({status:OrderState.PENDING,expiresAt:1000},OrderState.EXPIRED,{now:1001});
  assert.equal(transition(expired,OrderState.LATE_PAYMENT).status,OrderState.LATE_PAYMENT);
  assert.throws(()=>transition(expired,OrderState.PAID),/invalid_transition/);
  assert.throws(()=>transition({status:OrderState.PENDING,expiresAt:1000},OrderState.EXPIRED,{now:999}),/not_expired/);
});
