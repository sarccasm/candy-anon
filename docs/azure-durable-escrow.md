# Durable storage and retention: implementation status

## Azure configuration
Provision a **private** Azure Blob Storage container and configure the Azure Functions app:
- `AZURE_STORAGE_CONNECTION_STRING`: server-side secret (never commit or expose to frontend).
- `ENCRYPTED_ESCROW_CONTAINER`: private lowercase container name, e.g. `encrypted-fulfillment`.
- The deployed edge app must install `@azure/storage-blob` from `edge/package.json`.

The new `DurableEncryptedEscrow` writes PGP armored ciphertext through create-only blob writes. Repeated writes with the identical ciphertext succeed idempotently (SHA-256 checked); differing contents fail. The frontend must successfully escrow before showing BTC payment details. Shipment finalization checks the durable blob.

## What works
- Encrypted delivery payload remains in Azure Blob Storage if the Function process restarts, as long as the container and account remain available.
- A retention planner refuses to purge partial/late/unconfirmed payment states, records without carrier acknowledgement, or missing blockchain reconciliation/journal confirmation.
- Tests exercise simulated Azure restarts, conflicts, readback, TTL and existing simulated BTC flows.

## NOT YET PRODUCTION READY
1. **Invoice data still uses local `payments/*.json`** via `lib/store.mjs`. This means end-to-end recovery of orders after restart or across Azure instances is **not guaranteed**. Invoice creation, payment verification, inventory settlement and delivery receipts need one durable transactional source of truth, plus migration/reconciliation of old invoices.
2. The TTL worker is a **policy/coordinator**, not an enabled scheduled Azure cleanup job. Before enabling it, provision a reliable durable queue/scan, backend-only carrier acknowledgements, settlement tombstones, and verification from an independent blockchain provider.
3. This PR has **mocked Azure tests**, not live Azurite/real Azure integration. Existing BTC tests are synthetic Esplora fixtures, **not Bitcoin Core regtest**. Run real regtest with funded transactions, reorgs, missed blocks and mempool eviction before taking money.
4. The public anonymous escrow endpoint relies on an unpredictable bearer token; add rate limits, abuse protection, explicit metadata retention controls and TLS/WAF logs review.
5. Confirm Azure Blob soft-delete, versioning, backups and platform logs against the retention schedule. Expiring application metadata does not automatically delete Azure blobs.
6. Owner must provision Azure resources and secrets; do not deploy with local/mock storage.
