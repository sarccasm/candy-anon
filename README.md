# candy-anon

> Поточний код використовує Azure Table для каталогу, рахунків і атомарного списання
> залишків та приватний Azure Blob для зашифрованих даних доставки. Фоновий таймер
> перевіряє оплату й зберігає завдання на відправлення без відкритої вкладки.
> Реальної інтеграції перевізника ще немає. Початкові інструкції нижче частково
> застаріли; актуальні налаштування й обмеження описані тут:
>
> - [Локальне середовище та наскрізний тест](docs/local-staging.md)
> - [Каталог і міграція](docs/durable-catalog.md)
> - [BTC-адреси й міграція старих рахунків](docs/bitcoin-address-allocation.md)
> - [Фонова обробка та завдання на відправлення](docs/background-payments.md)
> - [Замовлення та проблемні оплати в адмінці](docs/admin-orders.md)
> - [Резерви, ручне передавання та керування оплатами](docs/order-operations.md)
> - [Звірка старих рахунків, секрети й хмарний захист](docs/cloud-readiness.md)
> - [Єдина міграція даних і локальна перевірка](docs/dataset-migration.md)

Minimal skeleton for a no-DB, privacy-first candy store:
- Origin in Ireland (Azure North Europe) + Cloudflare CDN
- Client-side PGP encryption of shipping data
- Crypto payments with watch-only wallets (BTC demo; XMR stub)
- No databases; no PII logging
- After payment, data is sent directly to carrier (mocked here)

## Structure
```
candy-anon/
  frontend/                   # Static site (Vite)
  edge/                       # Azure Functions (Node 18+)
    CreateShipment/           # POST /api/create-shipment
    PayCreate/                # POST /api/pay/create
    PayStatus/                # GET  /api/pay/status?token=...
```

## Quick start (local dev)

### 1) Frontend
```bash
cd frontend
npm i
npm run dev
# open http://localhost:5173
```

### 2) Azure Functions (edge)
Install Azure Functions Core Tools & Node 18+. Then:
```bash
cd edge
npm i
cp .env.example .env
# edit .env with your BTC_XPUB and HMAC_SECRET (for dev you can leave defaults)
# DEV MODE: PAY_ALWAYS_PAID=true to simulate paid status without node
# run:
# func start
```

The Functions default to route prefix "" so your endpoints will be:
- `POST http://localhost:7071/api/create-shipment`
- `POST http://localhost:7071/api/pay/create`
- `GET  http://localhost:7071/api/pay/status?token=...`

### 3) Wire frontend -> functions (dev)
Frontend calls `/api/...`. For local dev, add a proxy in `vite.config.js` (already included) to `http://localhost:7071`.

## Environment variables (edge/.env)
```
# Payment derivation
HMAC_SECRET=change_me
BTC_XPUB=your_zpub_or_xpub_here

# BTC node (optional; if missing, dev mode applies)
BTC_RPC_URL=http://127.0.0.1:8332
BTC_RPC_USER=rpcuser
BTC_RPC_PASS=rpcpass

# Dev override: mark every payment as paid
PAY_ALWAYS_PAID=false

# Shipment mock (no real carrier)
PGP_PRIVATE=-----BEGIN PGP PRIVATE KEY BLOCK-----\n...\n-----END PGP PRIVATE KEY BLOCK-----
PGP_PASS=passphrase_here
COURIER_API=https://example.courier/api
COURIER_TOKEN=dev-token
```

> **Production**: set `PAY_ALWAYS_PAID=false` and provide a real `bitcoind` RPC or your own scanner, plus real courier API.

## Notes
- No DB is used. Payment status is derived on-the-fly from the token -> address mapping. 
- For **Monero (XMR)** you'll want a view-only wallet via `monero-wallet-rpc` and subaddress per token; integrate similarly in `PayStatus`.

## Privacy reminders
- Do not log request bodies or IPs.
- Keep CDN/Function logging minimal; short retention.
- Client encrypts PII before sending; server forwards to carrier and discards.
