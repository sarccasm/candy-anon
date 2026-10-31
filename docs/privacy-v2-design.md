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
