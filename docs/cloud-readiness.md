# Cloud hardening and historical credential review

## Verified legacy invoices

`npm run legacy:check -- --network` checks the two current legacy mainnet invoices
only through Blockstream and mempool.space. It reads full paginated history and
mempool observations, compares confirmed/unconfirmed/eligible totals and fails
closed on incomplete, malformed or unavailable observations. Offline mode is the
default. Online use discloses the queried addresses to those two providers.

The current redacted result is `.local/legacy-reconciliation.json`. On the recorded
check both providers agreed on zero received sats for both invoices. The script
also examined 73 historical payment blobs and found one distinct invoice token for
each of those addresses among the scanned records. This does not establish wallet
ownership, prove that an address was never used elsewhere, or prevent a later
payment. No invoice, stock, reservation or address claim is changed. Keep the
invoices/address mapping for review and future late-payment monitoring; do not
reuse or delete them on the basis of a zero-funds snapshot.

## Historical credentials

`npm run secrets:audit` inspects the historical `.env`, Functions settings and local
certificate blobs. It prints only names, categories and counts; values and their
fingerprints are not included in the report. Its scope is the identified paths,
not a complete secret scan of every historical source file or external system.

The current inventory identifies:

| Historical material | Evidence and required action |
| --- | --- |
| `HMAC_SECRET` | Potential secret in old Functions settings. New invoices no longer use it. Remove it from new runtime settings only after the wallet owner preserves any recovery material needed for old mappings. |
| `PGP_KEY_PASSPHRASE` | Potential secret in old `.env`. If real or reused, have the trusted key owner rotate it outside the store. If the private key itself was exposed, merely changing its passphrase is insufficient: replace the recipient key and update the frontend pin through a reviewed key migration. Preserve controlled access to old keys while old ciphertext still needs recovery. |
| `PGP_PRIVATE_KEY_PATH` | A path reference, not evidence that the referenced private-key bytes were committed. The audit does not follow the path or read external private files. Ask the key owner to review that location. |
| `XPUB` | Public wallet identifier, not a signing secret. Do not replace it blindly: existing invoice addresses must remain recoverable. Review wallet privacy/ownership separately. |
| `frontend/certs/localhost-key.pem` | Actual historical local TLS private key. Treat it as exposed for development purposes; do not reuse it for public deployment. The staging setup generates a separate ignored local certificate/key. |

The current local admin key did not match a historical ADMIN_KEY value in those
scanned files. That is not proof that the deployed admin credential has rotated.
The report deliberately keeps `cloudRotationVerified: false`.

For actual Azure storage key rotation, inventory every consumer first, switch and
verify consumers before invalidating a key, and preserve rollback/data access.
Use the owning service's supported two-key procedure. Key Vault reference values
are cached by App Service; updating a secret alone does not prove every running
consumer has refreshed. Validate all Table/Blob and timer storage operations before
revoking an old key. No cloud key regeneration has been performed here.

Primary references:
[Azure Storage account keys](https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage),
[App Service Key Vault references and refresh](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references).

## Reviewable hardening plan

Copy `infra/cloud-target.example.json` to `.local/cloud-target.json` and fill the
subscription ID, resource group, existing Function App/storage names and exact
HTTPS frontend/admin origins. These fields are identifiers, not account keys.
Optional Cloudflare zone and existing alert action-group IDs document the remaining
deployment context; this tool does not create those resources.

```
npm run cloud:plan
```

Without a target the command lists missing fields and emits no operations. With a
validated target it writes `.local/cloud-hardening-plan.json`, containing explicit
Azure CLI argument arrays for review. The default command does **not** execute them. `--apply` is now implemented, but
the checked-in `local-only` operations policy blocks it before any cloud call.
External deployment and paid resources are currently prohibited by user choice. The proposed changes cover:

- HTTPS-only access, application and SCM TLS minimums, and disabled FTPS;
- exact frontend/admin CORS origins with credentialed CORS disabled;
- HTTPS/TLS storage and disabled anonymous public blob access;
- bounded host request bodies, disabled destructive escrow purge and analytics.

It does not regenerate keys, deploy code, change the active payment timer, replace
all app settings, or create paid compute/storage resources. The Azure CLI does not
support a `--scm-min-tls-version` switch on `functionapp config set`; the plan uses
the documented resource configuration update mechanism instead. All changes still
need actual-account validation and deployment/pipeline impact review.

Primary references:
[App/SCM TLS configuration](https://learn.microsoft.com/en-us/azure/app-service/tls-minimum-version),
[Functions configuration CLI](https://learn.microsoft.com/en-us/cli/azure/functionapp/config?view=azure-cli-latest),
[App Service access restrictions](https://learn.microsoft.com/en-us/azure/app-service/app-service-ip-restrictions?tabs=azurecli).

Once Azure CLI is installed and logged into the chosen account, this command is
read-only:

```
npm run cloud:audit
```

The audit requests resource properties and only app-setting names/Key Vault-reference
booleans. It does not print secret values or execute write operations. The result
is `.local/cloud-hardening-audit.json`; even all inspected checks passing does not
approve release. Origin bypass protection, current secrets, actual private escrow,
checkout policy, telemetry and external alert delivery need separate validation.
A project-local Azure CLI is now installed. Microsoft sign-in returned no accessible
Azure subscriptions. Cloud changes are disabled; no paid resource or external
deployment has been created.

## WAF, caching and monitoring

The application still needs protection at its chosen public gateway. Configure
client-specific limits for invoice creation/escrow, access controls for `/api/dash/*`,
and cache bypass for `/api/*` and authenticated requests. The application-wide
creation quota is not a substitute for client abuse limits. Prevent direct-origin
bypass using the actual gateway's supported identity/network controls; an ordinary
untrusted forwarding header is not authentication. Do not apply a deny-by-default
origin rule until gateway and operator paths are verified.

Cloudflare rate-limit capabilities and parameters depend on the account plan; no
zone or plan is known yet, so no rule was pushed or presented as deployed.
[Cloudflare rate-limit parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/).

Only the count-only `Function.ProcessPayments.User` log category is enabled at
Information in `host.json`. Broad request-success logging remains disabled so a
heartbeat does not require collecting successful payment URLs. The sample KQL in
`infra/monitoring/` detects missing heartbeats and attention batches. Confirm the
actual workspace schema and `AppRoleName`, then validate queries against real
telemetry and route alerts through an approved action group. No alert recipient was
chosen, and no notification was sent or configured.

[Functions log categories](https://learn.microsoft.com/azure/azure-functions/configure-monitoring?tabs=v2),
[Azure Monitor alert infrastructure](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/scenarios-monitoring).

Before activation, verify both public TLS endpoints, direct-origin denial, CORS,
private storage, secret-reference refresh, worker freshness, redacted traces,
client limits, cache bypass and actual test-alert receipt. Run the browser/regtest
suite separately; it does not certify the chosen cloud deployment.
