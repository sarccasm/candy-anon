import { eligibleForPurge } from './retention-policy.mjs';

// The caller must independently attest that an invoice address was reconciled
// and that a durable, privacy-minimized settlement tombstone exists.
export async function purgeReconciledRecord(store, id, {
  now = Date.now(),
  blockchainReconciled = false,
  tombstonePersisted = false
} = {}) {
  if (!blockchainReconciled || !tombstonePersisted) return { deleted: false, reason: 'safety_gate' };
  const record = await store.read(id);
  if (!record) return { deleted: false, reason: 'not_found' };
  if (!eligibleForPurge(record, now)) return { deleted: false, reason: 'retention_hold' };
  try {
    return { deleted: await store.deleteIfVersion(id, record.version), reason: 'eligible' };
  } catch (error) {
    if (error?.message === 'version_conflict') return { deleted: false, reason: 'concurrent_update' };
    throw error;
  }
}
