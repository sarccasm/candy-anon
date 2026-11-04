# Bitcoin invoice address allocation

New checkout invoices derive `XPUB/1/index`. Branch 0 is reserved for legacy
HMAC-derived invoices. Use a dedicated wallet whose branch 1 has never accepted
deposits or been used by another application. Verify wallet recovery and monitoring
of this branch before enabling checkout; ordinary wallet gap-limit discovery may
not find invoices after many abandoned checkouts.

`btc-address-counter-v1` in the `invoices` partition allocates non-hardened indices
using conditional ETag writes. Allocation conflicts retry a bounded number of times.
Failed invoice creation burns the index. Exhaustion and storage outages fail closed.

The invoice and permanent `btc-address:<sha256(address)>` claim are created in one
Azure Table transaction. A duplicate address cannot create a second invoice.
Never delete claims or reset the counter during retention, migration or recovery.
Never restore a stale storage backup and resume issuing invoices with the same
wallet without reconciling all previously issued addresses.

Uncommitted legacy invoices without `addressAllocationVersion: 1` require manual
review. Do not add the version flag to legacy records to bypass the check: their
addresses may have received payments for other invoices. Already committed records
remain readable and retain existing reorganization checks.

This change prevents address reuse between new invoices. It does not provide a
background settlement worker, transaction-level accounting for legacy deposits,
carrier delivery, or a complete production migration.
