// Retention policy functions are pure. Deletion is performed by a separate worker.
export const DEFAULT_RETENTION = Object.freeze({
  invoiceWindowMinutes: 20,
  unpaidReconciliationDays: 14,
  fulfilledEncryptedDays: 1,
  settlementJournalDays: 90
});

export function retentionDeadlines(createdAt, {
  invoiceWindowMinutes = DEFAULT_RETENTION.invoiceWindowMinutes,
  unpaidReconciliationDays = DEFAULT_RETENTION.unpaidReconciliationDays,
  fulfilledEncryptedDays = DEFAULT_RETENTION.fulfilledEncryptedDays
} = {}) {
  const created = new Date(createdAt).getTime();
  const vals = [invoiceWindowMinutes, unpaidReconciliationDays, fulfilledEncryptedDays];
  if (!Number.isFinite(created) || vals.some(v => !Number.isSafeInteger(v) || v < 1)) throw new Error('invalid_retention_policy');
  return Object.freeze({
    invoiceExpiresAt: created + invoiceWindowMinutes * 60_000,
    reconciliationEndsAt: created + unpaidReconciliationDays * 86_400_000,
    encryptedRetentionMs: fulfilledEncryptedDays * 86_400_000
  });
}

export function eligibleForPurge(record, now = Date.now()) {
  if (!record || !Number.isFinite(now)) return false;
  if (record.status === 'EXPIRED' && Number.isFinite(record.reconciliationEndsAt)) return now >= record.reconciliationEndsAt;
  if (record.status === 'FULFILLED' && record.fulfillmentAcknowledged === true && Number.isFinite(record.purgeAfter)) return now >= record.purgeAfter;
  return false; // Paid, partially paid, late, pending review and unknown states are never auto-deleted.
}
