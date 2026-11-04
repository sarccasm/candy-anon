# Reservations, manual handoff and operational controls

## Stock reservations

New HTTP-created invoices reserve stock in the same Azure Table transaction as the
invoice, permanent address claim, order-reference index and checkout admission.
`quantity` is physical on-hand stock; `reserved` is held for pending invoices.
The catalog exposes `quantity - reserved`. Existing stock rows without `reserved`
start at zero reserved stock. Existing invoices are not silently migrated to holds.

Settlement consumes both the hold and physical quantity once, atomically with the
paid invoice and durable fulfillment task. Legacy invoices can only consume stock
not held for other customers. Generic invoice CAS cannot alter reservation state,
pricing snapshots, operations versions or review/refund markers.

The timer releases an expired ACTIVE reservation only after both distinct configured
providers return complete observations with zero received and eligible sats. The
release and reservation status change are atomic/idempotent; invoices and address
claims remain. Partial, confirming, late and unverifiable payments keep their hold
for review. Late funds after release never trigger automatic fulfillment. No stock
is automatically restored after payment reorgs, manual refunds or acknowledged
handoff; those require physical/payment reconciliation.

Reservations prevent overselling but do not prevent anonymous stock-hoarding abuse.
The bounded global creation quota is only a basic guard. Before public traffic,
configure gateway/WAF client limits and abuse controls, and measure scan latency.
The existing scan implementation remains intended for small staging datasets.

## Real checkout admission policy

`checkout:policy` is required for creating invoices. Missing or invalid policy fails
closed. It contains `enabled`, a configuration revision, the server-owned USD/BTC
quote and update time, quote lifetime, and global per-minute creation quota.

The admin **Приймання нових оплат** control changes this policy. A stop does not
interrupt existing invoice verification, reservations, support or handoff. Every
admission conditionally updates the policy row in its reservation transaction;
a concurrent stop or quote update invalidates stale creation attempts. Failed
transactions leave no invoice, hold or address claim. Allocation may burn an index.

The local setup creates an enabled regtest-only policy and refreshes its synthetic
quote on rerun; it never re-enables a policy stopped by an operator. Cloud migration
must initialize the policy disabled and reconcile old invoices before activation.
The compatibility `/dash/publish` route now changes this real policy and requires
an operation version/request ID; it no longer writes a misleading local flag.

Quotes are manually supplied by an authenticated operator, not fetched automatically.
The default lifetime is 15 minutes. Expired quotes reject new invoices; existing
invoice amounts remain fixed. An invoice stores its quote snapshot. A below-minimum
BTC cart is rejected instead of silently raising its charge to the minimum amount.
Global limits count successful invoice creations, store no IPs, and preserve counts
through enable/disable and quote edits. Client-specific gateway limiting remains a
production deployment requirement.

## Manual handoff workflow

1. Open **Замовлення**, select an order or use the buyer's token in the password-style
   lookup field. Lookup sends the token in an authenticated POST body, not a URL.
   A successful lookup clears the field. Responses continue to hide bearer tokens,
   BTC addresses and delivery plaintext.
2. **Підготувати й завантажити шифротекст** performs fresh independent BTC checks,
   checks durable ciphertext and review/refund holds, then atomically records
   `HANDOFF_READY` and an audit event. The browser downloads a PGP `.asc` file named
   by the safe order reference. Only the trusted recipient can decrypt it outside
   the shop. Preparing/downloading alone is not acknowledgement or shipping.
3. Transfer the encrypted payload once to the trusted recipient using an agreed
   external channel. The application itself sends no carrier message or API call.
   Manual human workflow cannot guarantee exactly-once physical delivery.
4. Enter the recipient receipt/reference, explicitly attest the transfer, and select
   **Підтвердити ручне передавання**. The server rechecks BTC, requires HANDOFF_READY,
   and atomically records FULFILLED and the acknowledgement event. It stores a
   per-order hash of the receipt, not its plaintext. This is an authenticated
   operator attestation, not independently verified carrier API acknowledgement.

Every write uses an operation revision, UUID idempotency key and Azure ETag. Replayed
identical requests return the existing outcome; changed payloads under the same key
conflict. The invoice change and append-only-by-application audit row commit together.
A failed audit write cannot leave an acknowledged handoff. Stale operators cannot
overwrite each other. The shared admin key is represented by a pseudonymous key
fingerprint; this is not individual user attribution or a multi-user role system.

Reorg/provider failures hold unacknowledged work. Already FULFILLED tasks stay
FULFILLED with a payment hold/review flag: an observed chain change cannot undo a
physical handoff. Recovery never creates a new shipment or stock deduction.

## Support and refunds

Open reviews have allowlisted categories, including partial/late payment, stock and
refund-required. They block handoff and are included in the attention filter.
Closing a review records an allowlisted reason and rechecks payment; it cannot
mark an unpaid/late invoice paid or manufacture BTC confirmations.

The shop is watch-only and cannot execute refunds. The owner must handle actual
refunds through their wallet and reconcile them outside the application. The
external-refund closure reason records only the operator's declaration; it does
not verify a refund transaction. It sets a persistent fulfillment block which later
payment scans or unrelated review closures do not remove. It does not automatically
release reservations, restore physical stock or purge delivery ciphertext.

## Routes and visibility

All routes below require `x-admin-key`, have `no-store` responses and use the admin
origin. New operation bodies are capped at 16 KB. No raw errors are returned.

- GET `/api/dash/orders/{reference}`: safe details and a bounded audit page.
- POST `/api/dash/orders/lookup`: token lookup without putting the token in a URL.
- POST `/api/dash/orders/{reference}/action`: prepare, attest, open/close review.
- GET/POST `/api/dash/checkout`: versioned admission/quote policy.
- GET `/api/dash/health`: private escrow, worker freshness and policy summary.

New invoices get a permanent reference index. Older invoices have a bounded fallback
scan; if the scan limit is reached, use explicit token lookup. Audit reads are
bounded to 100 rows, sorted within the returned page; this is not unlimited history.
Encrypted `.asc` downloads are sensitive fulfillment artifacts even without plaintext.
Keep them in the trusted operational workflow and delete local copies according to
the agreed retention policy.

Health reports the last successful scan checkpoint, not actual alert delivery.
Retry/review batches emit count-only warning logs. Configure Azure/gateway alerts
for unavailable storage, stale worker checks and failed/review batches before launch.
The application has no configured external alert recipient.

## Release checks

`npm run preflight` records only safe paths/counts in `.local/security-preflight.json`.
It scans tracked private-key material and sensitive filenames in Git history without
printing their contents. Historical paths require owner review/real-key rotation;
the script does not prove rotation or rewrite history. The existing two legacy
invoices remain outside automatic live migration until reconciled.

The local app setting `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT=65536` bounds host parsing;
application limits are smaller where appropriate. Analytics now defaults off. If
explicitly enabled, it accepts only bounded session IDs, known page categories and
recent timestamps, and stores no raw referrer/query string or IP.

TLS enforcement, client rate rules, account secret rotation, access controls,
retention/backups and operational alert routing require the chosen deployment
account. Local tests do not configure or certify those cloud controls. Keep
`ENABLE_ESCROW_PURGE=false`: manual handoff does not populate all independent
reconciliation/journal/retention gates needed for destructive cleanup.

### Initialize an existing deployment's policy

After reviewing storage settings, fresh operator-supplied `USD_PER_BTC` and admin
key, run from `edge/` to inspect the disabled initial policy without touching Azure:

```
node scripts/initialize-checkout.mjs
```

Applying the reviewed plan is an explicit administrative step:

```
node scripts/initialize-checkout.mjs --apply
```

It atomically creates a **disabled** policy and a bootstrap audit row; an existing
policy is never overwritten. Reconcile legacy invoices/reservations, inspect the
catalog/stock, and refresh the quote before enabling new checkout in the admin UI.
This command was tested locally; no cloud policy initialization or activation has
been performed in this session.


### Current local-only restriction

`infra/operations-policy.json` disables cloud mutations, external deployment and
paid resources. Azure write commands and administrative migration CLIs check the
policy; only loopback Azurite writes are allowed. No cloud operation has been applied.
Local Functions HTTPS and private source backups can be tested without a subscription.
