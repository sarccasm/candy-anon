# Local staging: Azurite, Bitcoin regtest and browser checkout

This environment uses synthetic products and delivery details, the public Azurite
emulator account, and an isolated Bitcoin regtest chain. It does not use an Azure
subscription, real BTC or the existing `edge/data/payments` and inventory files.

## Install and start

Requirements: Docker with Compose, Azure Functions Core Tools 4 (validated with
4.1.2), npm and OpenSSL. The root project pins a local Node 22 binary because the
installed Functions host rejects Node 24. The system Node is not replaced.

From the repository root:

```
npm ci
npm ci --prefix edge
npm ci --prefix frontend
npm run local:up
npm run local:setup
```

Docker binds Azurite to `127.0.0.1:11000–11002` and Bitcoin RPC to
`127.0.0.1:19443`. Docker volumes belong to the `candy-anon-local` Compose project.
`local:setup` requires an actual regtest node, creates the private escrow container,
and migrates `fixtures/local-catalog.json` and `fixtures/local-inventory.json` into
`CandyLocalInvoices`. Catalog/stock rows use create-only transactions; rerunning
setup does not restore stock already consumed by tests or overwrite changed prices.
Unexpected catalog changes stop setup for review.

Generated settings live in `.local/settings.json` (mode 0600, Git-ignored). They
include a random admin key, a test-only XPUB, storage settings, isolated data path,
and the local certificate path. The recipient PGP private key is not needed or
stored: the browser uses the existing pinned public key. OpenSSL generates a local
certificate and a private TLS key; only test child processes trust that certificate
via `NODE_EXTRA_CA_CERTS`. TLS verification is never disabled globally.

The wallet is watch-only for `wpkh(tpub/1/*)` with indices 0–1000. Setup checks that
Core's `deriveaddresses` result matches application derivation of index 0. The seed
used to generate that test XPUB is discarded; the regtest miner wallet funds the
receiving addresses. These generated wallet settings are never suitable for real
funds or a production wallet. The miner's local RPC credential is a public fixture.

## Full test

```
npm run test:e2e
```

The test runs real Azure Functions HTTP handlers and the real minute timer, Vite,
headless Chromium/Chrome, Azure Table/Blob SDKs and actual Bitcoin Core transactions.
It starts and stops its own app processes, refuses occupied app ports, and leaves
Docker services/data available for inspection. App ports 5173/7071 and adapter ports
19101/19102 must be free. On macOS it uses installed Google
Chrome when available; elsewhere install Chromium first:

```
npx playwright install --with-deps chromium
```

Or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed compatible browser.

The scenario checks:

1. Browser catalog and checkout; pinned OpenPGP encryption; durable private Blob.
2. Browser/tab closure and a Functions process restart, preserving the invoice/blob.
3. Funding the exact regtest amount and mining confirmations. No browser polling or
   payment-status request is used while waiting for the real timer to settle.
4. Exactly one inventory deduction and a durable pending fulfillment task.
5. The authenticated admin browser view, real checkout stop/resume controls and idempotent shipment endpoint retries.
6. Actual block invalidation, a fulfillment hold, and recovery without another deduction.
7. Support lookup, audited review, encrypted download and explicit manual handoff acknowledgement in the browser.
8. No synthetic delivery plaintext in Table rows, ciphertext or app logs.

The redacted result is `.local/e2e-report.json`; a failure writes `passed: false`.
The whole test can take a few minutes because it waits for a real scheduled run.
There are no real carrier calls or delivery acknowledgements.

Both local HTTPS Esplora-protocol adapters read the **same regtest node**. They
exercise the two-source code path against real chain data but do not establish
independence of production providers. This is local staging, not a live Azure
recovery test. Destructive escrow cleanup stays disabled.

## Inspect the local app

After the test has stopped its processes, open three terminals:

```
npm run local:bridge
npm run local:edge
npm run local:frontend
```

Open `http://127.0.0.1:5173` or `/admin.html`. The admin key is in the private settings
file; do not paste it into Git or shared logs. `local:bridge` serves local protocol
adapters on ports 19101/19102. Functions uses `https://localhost:7071`; the Vite
proxy trusts only the generated development certificate via the test-process
`NODE_EXTRA_CA_CERTS`. Its upstream TLS verification stays enabled. A local certificate lasts 30 days; regenerate it with
setup when expired (setup renews certificates with less than one day remaining). Only run against an isolated development chain.

To stop containers without deleting the staging data:

```
npm run local:down
```

For a fresh fixture after stock is exhausted, stop local app processes and reset only
this Compose project's test volumes:

```
docker compose -p candy-anon-local -f compose.local.yml down --volumes
npm run local:up
npm run local:setup
```

This erases local staging orders/chain/storage; it does not touch `edge/data`.

## Existing project data

```
npm run migration:plan
```

This read-only command validates existing catalog/inventory and summarizes legacy
invoice reconciliation blockers in `.local/legacy-migration-plan.json`. It does not
print addresses, bearer tokens or delivery data. It never uploads or changes source
files. Any legacy invoices require review before a live traffic migration; they are
not silently converted to the new address scheme or marked paid.

Azure provisioning, live secrets, a recoverable production wallet, production
provider independence, legacy-payment reconciliation, reservation policy and carrier
handoff remain separate from this local setup. `edge/.env.example` is an unconfigured
cloud template with background/destructive jobs disabled.


The Functions host may still bind multiple interfaces; local regtest HTTP handlers
therefore require a server-only `LOCAL_API_KEY`. Vite binds `127.0.0.1` and injects
that header in its server-side proxy. It is not a `VITE_*` variable or a browser
credential. Core Tools host authentication is enabled, upstream TLS validation
stays on, and Vite's filesystem allowlist excludes `.local`, Git and private-key
files. Direct API calls without the local capability return 403. This is local
access protection, not a claim that a production WAF has been deployed.
