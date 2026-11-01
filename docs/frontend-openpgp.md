# Frontend + OpenPGP security notes

## Implemented
- OpenPGP is bundled from the project's pinned npm lockfile instead of loaded from a third-party CDN.
- The configured published recipient PGP key is pinned to fingerprint `03a747dccaeac2110ebefddfc23141930637370d`; a replacement key fails closed.
- Delivery details are validated in the browser, then encrypted with the public key before submission to the shipment API. The browser cart stores only catalog IDs, product names, prices and quantities, never shipping details.
- Checkout amount comes from the server invoice and the browser checks invoice structure. Errors are displayed without sensitive plaintext.
- Shipping details are cleared after successful/duplicate submission.
- CI runs a production frontend build and an actual encrypt/decrypt regression test using a temporary test-only keypair, plus a published-key fingerprint test.

## Important remaining limitations
- This is not end-to-end production readiness. **The current checkout retains the encrypted shipping blob in page memory until payment completes. Closing/reloading the tab can lose the shipment details.** Robust fulfillment requires the server to accept and hold ciphertext immediately after invoice issuance, then release it only on verified settlement, with timed deletion and reliable acknowledgement.
- A pin protects against accidental/key-file-only replacement, not a compromised build/deployment that can change both the bundled pin and the public key.
- The currently published key must correspond to a private key controlled by the trusted delivery recipient. No private key should be committed to Git.
- Protect the deployment with TLS and security response headers, rotate any compromised key, verify browser behavior manually, test mobile wallets, and do not accept live payments before the order lifecycle is integrated.
