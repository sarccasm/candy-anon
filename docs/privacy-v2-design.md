# Privacy-first order lifecycle (v2, phase 1)

This change introduces **pure, tested** state-transition and retention policy modules. It does **not** yet connect them to live invoice endpoints or run destructive cleanup.

## Principle
No customer name, email, phone or plaintext delivery address in persistent records. Only minimized technical metadata necessary for stock, invoice and settlement. Encrypted delivery payloads are not anonymous by definition. Blockchain amounts, timestamps, addresses and logs may still be linkable.

## States
PENDING -> PARTIALLY_PAID / CONFIRMING / PAID; unpaid invoice becomes EXPIRED after its payment window. A late BTC payment becomes LATE_PAYMENT -> MANUAL_REVIEW, never discarded. Verified payment progresses PAID -> FULFILLMENT_PENDING -> FULFILLED after explicit receipt acknowledgment. Reorganizations, anomalies and stock shortages require MANUAL_REVIEW. Illegal transitions throw.

## Suggested retention (configurable)
- Payment window: 20 minutes. This is a **quote expiry**, not permission to discard an unpaid invoice immediately.
- Unpaid invoice reconciliation: 14 days, after independent blockchain reconciliation. Do not delete records with unconfirmed, partial, late or disputed payments.
- Encrypted fulfillment payload: 1 day after verified carrier acknowledgment, contingent on operational/legal retention requirements.
- Minimal settlement/tombstone journal: 90 days initial proposal, subject to risk and legal review. Prevents replay; not customer identity storage.

## Production prerequisites (not implemented here)
1. Durable transactional store with conditional writes and idempotency, to replace file-based invoice/inventory JSON in Azure Functions.
2. Scheduled reconciliation worker with late deposits, multiple incoming transactions, chain reorganizations, and manual exceptions.
3. Real carrier-side encryption/decryption contract, acknowledged delivery handoff, and bounded retries.
4. Confirm operational and legal retention requirements, backups and platform/CDN logs; rotate any previously disclosed credentials.
5. Testnet/regtest, full API integration tests and security review.

**Nothing is automatically deleted by this PR.** The pure predicate `eligibleForPurge()` must never be used as the sole criterion for deletion without confirmed reconciliation and a durable tombstone.

## Phase 2 prototype (implemented)
- `MemoryTemporaryStore`: ephemeral test-only adapter with versioned compare-and-swap semantics and defensive copies.
- `purgeReconciledRecord`: no deletion without external blockchain reconciliation, durable journal acknowledgement and a retention-eligible state. A version mismatch prevents stale deletion.
- Unit tests cover concurrency version conflicts, data isolation, and deletion safety gates.
- No production Azure adapter, scheduler or actual deletion has been activated. **Memory state vanishes on process restart** and should never store live orders.

## Phase 3: Azure Table conditional-write adapter
- `AzureTemporaryStore` implements create, read, compare-and-swap and version-checked deletion with Azure Table ETags.
- Pass a configured `@azure/data-tables` `TableClient`; this phase deliberately does not connect it to live checkout or deploy credentials. The table must exist.
- Azure Table Storage is durable; `expiresAt` is an **application deadline**, NOT automatic Table Storage TTL. No deletion happens without reconciliation and an explicit worker.
- Azure Table entities have size limits, so store only minimized JSON technical state. Do not store encrypted shipping payloads in this adapter.
- Before production: separate a durable idempotency ledger from expiring order state; create an Azure reconciliation/retention worker, integration tests with Azurite + BTC regtest, rate limiting, secrets rotation and security review.
