# Admin order list

The **Замовлення** screen reads `GET /api/dash/orders` using `x-admin-key` and the
existing server-side `ADMIN_KEY`. The HTTP trigger is host-anonymous; the handler
requires the application admin key before reading storage. Responses use `no-store`.
There are no payment, fulfillment, refund or deletion write actions on this screen.

The list includes technical SKU quantities, invoice amount in sats, the amount
recorded at settlement, payment/fulfillment states and the last verification time.
The settled amount is historical, not a fresh blockchain balance. Checks older than
five minutes are marked stale. A settled order with stale verification or no task,
partial/late payments, reorgs, provider failures and corrupt/legacy records are
included in **Потребують уваги**. An expired unpaid invoice alone is not flagged.

Invoice bearer tokens, BTC addresses, delivery data, ciphertext, Blob paths, raw
errors, storage credentials and ETags are not returned. Order references are stable
96-bit truncated SHA-256 hashes with an admin-specific domain prefix. They cannot
be used as invoice bearer tokens and are not a customer lookup endpoint.

Each request scans at most 50 raw Azure Table rows. Filters apply to those rows;
metadata rows and nonmatching invoices can produce an empty page that still has a
next page. The UI keeps the next-page control available in that case and deduplicates
loaded records. Sorting by creation date applies only to loaded results, not the
whole database; this is not a global latest-orders query. For large datasets add a
separate time/status index rather than scanning the entire table in one request.

Azure continuation tokens can encode invoice row keys. Browser cursors therefore
use AES-256-GCM encryption authenticated with a key derived from `ADMIN_KEY`. They
expire after 30 minutes and are bound to the selected filter. Refresh the list after
expiry or key rotation. The browser discards older responses when filters change.
Storage failures display an error rather than a fabricated empty successful list.

The view shows the latest persisted server observation; opening it does not call
BTC providers or override a review state. Pending fulfillment still means a durable
task awaiting a carrier integration, not a completed shipment. No production data
migration is needed for the view itself, but Table configuration and earlier
invoice/catalog migration prerequisites still apply.
