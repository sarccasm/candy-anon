import { transition } from './order-state.mjs';

// Read-only observer -> versioned order update. Never settles stock or ships.
const ACTIVE = new Set(['PENDING','PARTIALLY_PAID','CONFIRMING','EXPIRED']);
const ALLOWED_OBSERVED = new Set(['PENDING','PARTIALLY_PAID','CONFIRMING','PAID','EXPIRED','LATE_PAYMENT']);
export async function reconcileOrder({ store, id, observer, now = Date.now(), maxRetries = 3 }) {
  if (!store?.read || !store?.compareAndSwap || typeof observer !== 'function')
    throw new Error('invalid_dependencies');
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 1 || maxRetries > 8) throw new Error('invalid_retries');
  // Every retry gets a fresh observation rather than reusing potentially stale chain state.
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const order = await store.read(id);
    if (!order) return {status:'NOT_FOUND'};
    if (!ACTIVE.has(order.status)) return {status:'NO_CHANGE',state:order.status};
    const observed = await observer({
      address:order.address, expectedSats:order.amountSats,
      expired:order.status === 'EXPIRED' || now >= order.expiresAt
    });
    if (!ALLOWED_OBSERVED.has(observed?.status)) throw new Error('invalid_observation');
    // An expired quote receiving money must be manually reconciled; never auto-fulfill it.
    let next = observed.status;
    if (next === 'PAID' && (order.status === 'EXPIRED' || now >= order.expiresAt)) next = 'LATE_PAYMENT';
    if (next === 'PENDING' && now >= order.expiresAt) next = 'EXPIRED';
    if (next === order.status) return {status:'NO_CHANGE',state:order.status};
    if (next === 'PENDING' && order.status !== 'PENDING') return {status:'NO_CHANGE',state:order.status};
    const patched = { ...order, paymentVerified: next === 'PAID', 
      lastObservedSats: observed.receivedSats, lastObservedAt: new Date(now).toISOString() };
    let nextRecord;
    try {
      if (order.status === 'EXPIRED' && next !== 'LATE_PAYMENT') return {status:'NO_CHANGE',state:order.status};
      nextRecord = transition(patched, next, {now});
    } catch (e) {
      if (e?.message === 'invalid_transition') return {status:'NEEDS_REVIEW',from:order.status,to:next};
      throw e;
    }
    try {
      const saved = await store.compareAndSwap(id,order.version,()=>nextRecord);
      return {status:'UPDATED',state:saved.status,version:saved.version};
    } catch(e) {
      if (e?.message !== 'version_conflict') throw e;
    }
  }
  return {status:'RETRY_REQUIRED'};
}
