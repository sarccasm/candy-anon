# Combined catalog, stock and legacy migration

The default command plans without network access or writes:

```
npm run migration:dataset
```

It validates the current `edge/data/state.json`, inventory and invoice files, then
reports only counts and a source digest. Applying requires a disabled checkout
policy, an empty destination for every created row, and fresh legacy evidence from
both approved providers. The evidence is bound to each invoice's source digest and
must be at most one hour old. A changed token/address/amount/date/items record cannot
reuse a previous check. A completed identical migration can be replayed without
resetting stock or importing invoices again.

The apply path backs up all selected source files with AES-256-GCM before writing,
reads the encrypted file back and verifies decryption against the source snapshot.
Backup and key files are private, Git-ignored and stored under
`.local/migration-backups/<run-id>/`. The key is currently colocated for local
recovery testing; before using a backup operationally, protect/recover the key
separately. This is not a cloud Key Vault backup or a claim of off-device durability.

One Azure Table transaction creates the catalog, stock with zero reservations,
legacy invoice metadata, safe reference indexes and the completed migration marker.
It conditionally updates the stopped policy row in the same batch, so a concurrent
checkout activation prevents the migration. Any existing destination row aborts the
whole batch. Batches above 100 operations, source settlement journals, already
committed invoices, unknown SKUs and malformed cart quantities require a separate
reviewed migration; they are not silently dropped.

Legacy invoices stay uncommitted, without the new allocation-version flag or stock
reservation, and enter open payment review. A zero-funds snapshot never marks an
invoice paid, deletes it or allows address reuse. Original source files are never
modified. Ciphertexts/real delivery handoff require their own continuity review;
this migration does not synthesize missing delivery data.

Current user policy permits **only local** application:

```
node edge/scripts/preview-dataset-migration.mjs
```

That command uses the public-key loopback Azurite emulator, creates a new isolated
review table, initializes checkout disabled and verifies readback. It does not
switch the running demo app to that table. The actual local rehearsal imported
8 products, 8 stock rows and 2 legacy invoices; the report is
`.local/dataset-migration-preview.json`. Public Azure is not configured or deployed.

The general `--apply` migration command is blocked for non-loopback storage by
`infra/operations-policy.json`. A future decision to use Azure requires the user to
lift that restriction, supply an authenticated subscription, review the target and
source, and preserve the paid-order/stock continuity plan. Do not copy a local
regtest XPUB into a real wallet configuration.
