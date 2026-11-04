# Background payment processing and durable fulfillment tasks

`ProcessPayments` runs every minute. It uses the same `reconcileInvoice` service as
`PayStatus` and the compatibility `CreateShipment` endpoint. Closing a browser after
successfully saving encrypted delivery details no longer prevents settlement.

## Durable boundary

For new invoices (`addressAllocationVersion: 1`), one Azure Table transaction writes:

- all stock deductions, with stock ETag checks;
- the committed invoice, settled amount and commit timestamp;
- an embedded `fulfillment` task with `status: PENDING`, `idempotencyKey: token`,
  `encryptedBlob: <token>.asc` and `createdAt`.

A task means the paid order is waiting for fulfillment. It is not a carrier booking
or delivery acknowledgement. No customer plaintext is added to the invoice. The
ciphertext remains in the private Blob container. No new shipment files are written.
Repeated worker runs and client requests cannot deduct stock twice or create a
second embedded task. The ciphertext must exist before new settlement or task repair.

The compatibility shipment endpoint performs current independent BTC verification
and returns success for an existing pending task. A new frontend does not need this
endpoint: a successful paid response already confirms the durable task.

## Scanning and recovery

The worker scans bounded Azure Table pages and persists progress in
`worker:payment-scan:v1`. It ignores non-invoice rows, wraps at the end, and revisits
provider failures and late deposits on later scans. Empty pages with continuation
tokens retain progress. A crash before a checkpoint repeats that page safely.
ETag conflicts on the checkpoint fail the invocation instead of silently replacing
another worker's progress. Do not delete the cursor while a worker is running.

Each provider observation has a 20-second cancellation deadline, including paginated
history and final tip reads. Per-request deadlines also apply. Invoice failures are
isolated; summary logs contain counts only, never bearer tokens or addresses.

Default `PAYMENT_SCAN_BATCH_SIZE` is 3 raw Table rows per invocation (range 1–100).
Address registry/catalog rows also consume scan slots. Full scans include settled
and expired invoices to detect reorgs and late deposits. This prototype is intended
for small staging datasets: measure full-scan latency against the 20-minute payment
window before accepting traffic. A larger deployment needs an indexed due-work
queue, bounded concurrency, provider capacity planning and separate reorg monitoring.
Increasing the batch size can exceed the Functions execution timeout.

## Review and retry states

Partial, confirming and expired payments never produce a fulfillment task. Late
funds, inconsistent invoices and legacy HMAC invoices require review. The quote
window remains conservative: an invoice first settled after 20 minutes requires
review even if a transaction was broadcast earlier. Stock shortages remain pending
for reconciliation; money is not refunded automatically.

A committed order losing BTC confirmations is recorded as `REORG_REVIEW`; its task
becomes `ON_HOLD`. Provider failures also hold queued work. A later successful
independent verification returns the task to `PENDING` without another deduction.
No inventory is automatically restored on reorg. Legacy committed invoices are
readable but do not acquire automatic fulfillment tasks.

## Deployment prerequisites and remaining work

Configure existing Table/Blob settings and `MIN_CONFIRMATIONS`, plus
`AzureWebJobsStorage` for Azure Functions timer locks and schedule monitoring.
Use distinct trusted HTTPS Esplora origins. The worker does not accept two paths on
the same origin as independent sources. Use Node 22 or newer.

To deploy code while keeping the timer disabled, set the Azure app setting
`AzureWebJobs.ProcessPayments.Disabled=true`. Validate address allocation, reviewed
catalog/stock migrations, provider configuration and scan capacity before enabling.
No deployment or live-data migration is performed by adding this code.

There is no carrier adapter or dispatcher yet. A future dispatcher must use a durable
lease, current payment verification, and the token as a carrier-supported idempotency
key; it must persist carrier acknowledgement before marking a task fulfilled. Do not
treat `PENDING` as permission to purge ciphertext. The existing destructive cleanup
flag remains separate and must remain off until acknowledgement and retention gates
are fully implemented and tested.

Tests exercise browser-independent settlement, restart recovery, competing callers,
stock shortages, missing ciphertext, late/partial deposits, provider failures, reorg
holds and scan continuation. The Azurite integration uses the real Azure Table SDK;
BTC observations and Blob existence in that worker integration are test fixtures,
not live Bitcoin or carrier verification.
