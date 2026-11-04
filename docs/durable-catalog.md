# Shared durable catalog

The storefront, invoice creation and admin dashboard now read `catalog:v1` in the
`invoices` Azure Table partition. The JSON payload contains product IDs, names,
prices, tags and presentation colors. Stock remains in separate `stock:<sku>` rows;
editing metadata must not overwrite stock or settlement records.

Before switching traffic, review the authoritative `state.json` product list and
ensure every SKU has a provisioned stock row. Stop checkout during migration.
From `edge/`, validate without accessing Azure:

```
node scripts/migrate-catalog.mjs data/state.json
```

After reviewing the source and configuring the existing Azure storage environment:

```
node scripts/migrate-catalog.mjs data/state.json --apply
```

Apply creates the catalog once. It refuses to overwrite an existing catalog.
There is no automatic import or fallback to local products when Azure is unavailable.
Keep a backup of the reviewed source. Catalog payloads are limited to 60 KB UTF-16
and 500 products; larger catalogs require a different storage layout.

Admin saves include the catalog ETag. Stale edits return HTTP 409 and reload the
current catalog. Names, prices and tags persist together. Existing invoices retain
their original amounts. New browser checkout requests include the displayed total
in cents; a price mismatch returns 409 before creating an invoice or allocating an
address, refreshes the browser catalog and requires another checkout attempt.

Admin routes are `/api/dash/*`, authenticated by server-side `ADMIN_KEY` through
`x-admin-key`. Azure HTTP triggers are anonymous at the host layer so an additional
Function key is not required in the browser; handlers still reject absent or invalid
admin keys. Configure platform CORS and access restrictions for the admin origin.

The publish flag and analytics still use local files. The publish switch is not a
checkout kill switch. Background payment settlement and carrier handoff are separate
remaining work.
