// Pure order lifecycle rules: no customer identity, filesystem, or network access.
export const OrderState = Object.freeze({
  PENDING: 'PENDING',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  CONFIRMING: 'CONFIRMING',
  PAID: 'PAID',
  FULFILLMENT_PENDING: 'FULFILLMENT_PENDING',
  FULFILLED: 'FULFILLED',
  EXPIRED: 'EXPIRED',
  LATE_PAYMENT: 'LATE_PAYMENT',
  MANUAL_REVIEW: 'MANUAL_REVIEW'
});

const EDGES = Object.freeze({
  PENDING: ['PARTIALLY_PAID', 'CONFIRMING', 'PAID', 'EXPIRED', 'MANUAL_REVIEW'],
  PARTIALLY_PAID: ['CONFIRMING', 'PAID', 'EXPIRED', 'MANUAL_REVIEW'],
  CONFIRMING: ['PARTIALLY_PAID', 'PAID', 'EXPIRED', 'MANUAL_REVIEW'],
  PAID: ['FULFILLMENT_PENDING', 'MANUAL_REVIEW'],
  FULFILLMENT_PENDING: ['FULFILLED', 'MANUAL_REVIEW'],
  FULFILLED: [],
  EXPIRED: ['LATE_PAYMENT'],
  LATE_PAYMENT: ['MANUAL_REVIEW'],
  MANUAL_REVIEW: ['PAID', 'FULFILLMENT_PENDING', 'FULFILLED']
});

export function transition(order, next, { now = Date.now(), reason } = {}) {
  if (!order || typeof order !== 'object' || !EDGES[order.status]) throw new Error('invalid_order_state');
  if (!EDGES[order.status].includes(next)) throw new Error('invalid_transition');
  if (!Number.isFinite(now)) throw new Error('invalid_timestamp');
  if (next === 'PAID' && order.paymentVerified !== true) throw new Error('payment_not_verified');
  if (next === 'FULFILLED' && order.fulfillmentAcknowledged !== true) throw new Error('fulfillment_not_acknowledged');
  if (next === 'EXPIRED' && (!Number.isFinite(order.expiresAt) || now < order.expiresAt)) throw new Error('not_expired');
  return { ...order, status: next, updatedAt: new Date(now).toISOString(), ...(reason ? { reviewReason: reason } : {}) };
}

export function classifyPayment({ amountSats, receivedSats, confirmations, requiredConfirmations, expired = false }) {
  if (![amountSats, receivedSats, confirmations, requiredConfirmations].every(Number.isSafeInteger)
    || amountSats <= 0 || receivedSats < 0 || confirmations < 0 || requiredConfirmations < 1) throw new Error('invalid_payment');
  if (expired) return receivedSats > 0 ? 'LATE_PAYMENT' : 'EXPIRED';
  if (receivedSats === 0) return 'PENDING';
  if (receivedSats < amountSats) return 'PARTIALLY_PAID';
  return confirmations >= requiredConfirmations ? 'PAID' : 'CONFIRMING';
}
