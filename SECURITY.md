# Deployment and security checklist

> This is a prototype. **Do not use for real payments or customer data** until all production blockers below are resolved and end-to-end tests pass.

## Required environment
- `ADMIN_KEY`: new cryptographically random secret, at least 24 characters (not the old dev123). Set it in Azure app settings only.
- `XPUB`: production Bitcoin extended public key from a dedicated wallet; **never deploy a private wallet seed**.
- `HMAC_SECRET`: new cryptographically random secret; changing this changes address derivation for new invoices.
- `USD_PER_BTC`: a validated current BTC/USD quote; the service does not fetch or refresh this and must not be left stale.
- `MIN_CONFIRMATIONS`: integer 1–100, choose a policy suitable for the transaction risk.
- `ALLOW_ORIGIN`: explicit trusted frontend origin.
- Configure durable private storage rather than the deployment filesystem, with backup, access controls and transactional/idempotent operations.

## Production blockers
1. **Secrets and history:** Previously tracked `.env`, Azure settings, development certificates and payment JSON remain accessible in the Git history. Audit/rotate any real keys. Git history rewrite would require a coordinated force-push and should be separately approved after backup, including coordination with other clones.
2. **Payments:** This implementation uses file-based invoices and balance polling. It has not been tested for reorgs, partial payments, double delivery, high load, or provider outages. Test with testnet/regtest before real BTC.
3. **Inventory:** Stock is reserved when an invoice is generated, and there is no safe automatic expiry/release/reconciliation for abandoned invoices. The reservation is not a cross-worker transaction. Add a real transactional store, lease expiry and late-payment reconciliation before launch.
4. **Fulfillment:** Shipments are stored as encrypted PGP blocks but **no real carrier handoff exists**. The shipping partner must receive and decrypt the data in a trusted workflow; encryption by itself is not shipping.
5. **Privacy:** Audit all existing data and platform/CDN logs, apply retention limits and access controls; rotate any exposed PGP private-key material. Client telemetry remains session-level.
6. **Operational checks:** Enforce TLS, rate limiting, request caps, monitoring, alerts, dependency updates and a reviewed deployment process. Keep payment processing disabled until ready.

## Validation
- GitHub Actions checks JS syntax and security regression guard tests.
- Manual staging tests must cover tampered cart prices/quantities, invoice status overrides, unconfirmed and partial transactions, duplicates, provider outages, admin authentication, checkout UX, stock shortages, shipment retries, filesystem errors and restart/persistence behavior.

Never put secrets or live payment records in source control.
