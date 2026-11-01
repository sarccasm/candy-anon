# Durable checkout deployment gate

## Implemented in this branch
- Azure Table invoice create/read with optimistic ETag updates.
- **Atomic settlement:** a single Table batch transaction updates invoice `committed` and all SKU stock rows, with per-row ETag checks; repeat settlement is idempotent.
- Payment verification is fail-closed on missing or truncated Esplora history, expired quotes, missing escrow and missing inventory.
- Catalog and invoice quote stock checks read authoritative Table stock quantities.
- PGP encrypted shipping data is stored in a private Azure Blob container separately from invoice technical metadata.
- Unit tests simulate atomic settlement, retries, shortages, partial payment, and ciphertext recovery.

## Provisioning prerequisites
1. Provision an Azure Table named by `AZURE_INVOICES_TABLE`; set server-only `AZURE_STORAGE_CONNECTION_STRING`.
2. In the table create stock entities with partition `invoices`, row key `stock:<sku>`, numeric `quantity`. Migrate **authoritative** inventory from current files and reconcile all pre-existing pending invoices before accepting BTC; otherwise API fails closed.
3. Provision a private Blob container named by `ENCRYPTED_ESCROW_CONTAINER` and configure the same connection string.
4. Enable `MIN_CONFIRMATIONS` appropriate to risk, live RPC monitoring, availability alerting and provider checks.
5. Install edge dependencies from `edge/package.json`, secure environment variables, secret rotation, and backups. Do not expose storage credentials to the browser.
6. Review and migrate existing active file-based invoices and settlements before switching traffic. Migration is a separate controlled administrative operation.

## Release blockers
- Tests run with mocked Azure Table/Blob clients and synthetic BTC transactions. No actual Azure account, Azurite, Bitcoin Core regtest, or courier account was available in this session. Production recovery and exactly-once settlement are not independently established until those integrations pass.
- No scheduled TTL cleanup worker or verified carrier acknowledgements have been deployed. Do not enable destructive cleanup until durable receipt and reconciliation are recorded.
- Existing admin product changes remain local-file-backed and will not update authoritative Azure stock until the admin write path is migrated.
- No production traffic migration or deployment has been performed. Keep PR Draft until integration tests and operational review pass.

## Scheduled retention timer (added)
`edge/EscrowCleanup` runs hourly and scans up to `ESCROW_PURGE_BATCH_SIZE` blobs per run (default 50). By default it is DRY RUN. Set `ENABLE_ESCROW_PURGE=true` **only after** durable backend-only carrier acknowledgements, `paymentStatus`, `blockchainReconciled`, `settlementJournalPersisted`, and `purgeAfter` are written by authenticated workers and fully tested. There is no client endpoint for asserting these booleans. Blob soft-delete/versioning/backups may retain encrypted bytes beyond an application delete.

### Still not a deployed, end-to-end checkout
All code remains on a Draft PR, with no confirmed provisioned Azure resources or production secrets. No live payment/regtest or real delivery-carrier integrations were executed. Migrate admin inventory writes before enabling checkout.
