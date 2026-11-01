import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderState, transition, classifyPayment } from '../edge/lib/order-state.mjs';
import { retentionDeadlines, eligibleForPurge } from '../edge/lib/retention-policy.mjs';

test('payment classification handles partial, unconfirmed and late funds', () => {
  const base = { amountSats: 50000, confirmations: 0, requiredConfirmations: 2 };
  assert.equal(classifyPayment({ ...base, receivedSats: 0 }), 'PENDING');
  assert.equal(classifyPayment({ ...base, receivedSats: 1000 }), 'PARTIALLY_PAID');
  assert.equal(classifyPayment({ ...base, receivedSats: 50000 }), 'CONFIRMING');
  assert.equal(classifyPayment({ ...base, receivedSats: 50000, confirmations: 2 }), 'PAID');
  assert.equal(classifyPayment({ ...base, receivedSats: 50000, expired: true }), 'LATE_PAYMENT');
  assert.throws(() => classifyPayment({ ...base, receivedSats: -1 }), /invalid_payment/);
});

test('cannot claim payment without verification or fulfill without acknowledgment', () => {
  const order = { status: OrderState.PENDING, expiresAt: 1000 };
  assert.throws(() => transition(order, 'PAID', { now: 500 }), /payment_not_verified/);
  assert.throws(() => transition(order, 'EXPIRED', { now: 500 }), /not_expired/);
  assert.equal(transition(order, 'EXPIRED', { now: 1000 }).status, 'EXPIRED');
  assert.equal(transition({ status: 'EXPIRED' }, 'LATE_PAYMENT').status, 'LATE_PAYMENT');
  assert.throws(() => transition({status:'FULFILLMENT_PENDING'},'FULFILLED'),/fulfillment_not_acknowledged/);
  assert.equal(transition({status:'FULFILLMENT_PENDING',fulfillmentAcknowledged:true,paymentVerified:true},'FULFILLED').status,'FULFILLED');
});

test('retention never purges unsettled or unacknowledged records', () => {
  const dates = retentionDeadlines('2026-01-01T00:00:00Z');
  assert.equal(dates.invoiceExpiresAt, Date.parse('2026-01-01T00:20:00Z'));
  assert.equal(eligibleForPurge({status:'PARTIALLY_PAID',reconciliationEndsAt:1},1000),false);
  assert.equal(eligibleForPurge({status:'MANUAL_REVIEW',reconciliationEndsAt:1},1000),false);
  assert.equal(eligibleForPurge({status:'EXPIRED',reconciliationEndsAt:100},100),true);
  assert.equal(eligibleForPurge({status:'FULFILLED',fulfillmentAcknowledged:false,purgeAfter:100},200),false);
  assert.equal(eligibleForPurge({status:'FULFILLED',fulfillmentAcknowledged:true,purgeAfter:100},200),true);
});

test('cannot hand off fulfillment before payment verification',()=>{
  assert.throws(()=>transition({status:'PAID',paymentVerified:false},'FULFILLMENT_PENDING'),/payment_not_verified/);
  assert.equal(transition({status:'PAID',paymentVerified:true},'FULFILLMENT_PENDING').status,'FULFILLMENT_PENDING');
});
