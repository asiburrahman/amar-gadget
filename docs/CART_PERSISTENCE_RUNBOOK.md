# Cart persistence, checkout lineage and recovery

AUD-023 replaces the browser-global cart and the `/api/cart` 501 response with authenticated PostgreSQL carts, an independent guest cart and explicit recovery/import operations. The root bridge and every existing add-to-cart entry point use the same controller. This document describes application behavior and the verification boundary; it does not certify a production deployment or live payment flow.

## Account ownership and synchronization

The verified current session selects the account. `X-Cart-Owner` is a precondition that must match that session, never permission to select another owner. The service locks User then Cart and rechecks verification, role and session version after obtaining the locks. Copied revoked sessions and requests queued before an account transition are rejected. Account cart snapshots stay in memory and are never serialized into guest localStorage.

The root bridge clears the previous account immediately, aborts obsolete requests, and publishes reads only for their captured scope, epoch and generation. It refreshes after mutations, on focus/visibility, through cross-tab invalidations and every 30 seconds while visible. Session revalidation uses the shared auth store. This provides consistent server persistence and eventual visible-client refresh, not an instant WebSocket subscription. Broadcast messages contain an owner invalidation only; another tab reloads its own authorized data.

Cart writes submit the observed revision and a random request ID. SQL serializes edits, increments the revision once per logical change and stores the most recent request hash/result. An immediate identical retry returns that result without applying another increase. Reusing the same ID for different input is rejected. After an intervening request replaces that bounded receipt, an old revision is rejected; the controller refreshes and asks for review rather than silently replaying an uncertain increment with a new ID. A committed mutation remains successful if its subsequent read, storage cleanup or broadcast fails.

A new cart has a 100-product cap and quantity bounds of 1–100. Product IDs in CartLine are intentionally soft catalog references: deleting or hiding a product must not remove its saved identity or reset the cart revision. Unavailable references return no product metadata and remain removable. New entries/increases require current public visibility and sufficient stock. Reductions and removal remain possible for retained overstock/unavailable lines. Cart membership does not reserve inventory.

## Current prices, coupons and checkout binding

Account reads and guest resolution hydrate current approved-product/approved-seller metadata from SQL, including effective prices, stock and safe public media URLs. Cached product names, prices and stock are never authoritative cart inputs. Unavailable rows display an unavailable state, without a fabricated zero-price purchase. The header shows a review label while the cart is unverified.

Cart totals come from the existing server quote. Catalog refreshes increment a client catalog revision, invalidating an older quote even when product IDs and quantities remain unchanged. Checkout is blocked during sync/mutations, for unavailable or insufficient-stock selections, and while a linked checkout requires recovery. Coupon persistence records a requested code; the quote validates eligibility and the actual discount. Applying a coupon rechecks cart scope/revision and in-flight mutations after validation. Re-applying the same non-null text is a new coupon intent, protected by couponVersion.

Checkout submits owner/source identity, cart and coupon revisions, and the exact selected product/line IDs and quantities. The server derives the actor independently and checks that context before quote, stock or order writes. A populated account cart cannot be bypassed by omitting its context. Legacy/manual callers without an account cart retain the existing server-priced checkout contract; they do not gain arbitrary owner selection.

COD acceptance consumes only purchased quantities in the same transaction as order creation. Stripe reservations retain the cart until verified payment. The signed webhook consumes purchased quantities under the same owner lock and marks cartConsumedAt exactly once. A stable matching line is reduced; a removed/re-added line has a new ID and survives, as do extra quantities. The coupon clears only when matching lines changed and the captured coupon revision/code still match. Cancellation/expiry retain cart items, and late payment on a cancelled order remains refund review without consuming the cart.

The account cart API exposes its one linked PENDING/UNPAID checkout and a bounded, owner-only recent receipt from the last seven days. This helps recover a lost COD response even after its cart was consumed. A partial unique SQL index independently enforces one active linked account checkout. The recent receipt is not a new payment-confirmation source.

## Independent guest storage

`amar-gadget-cart-guest-v3` stores only product/line IDs, quantities, coupon intent/revisions, source identity and bounded receipt references. It stores no prices, product names, shipping/contact details or checkout secrets. The source ID remains stable when visible items are cleared, and pending receipts are retained. Session-specific strong checkout secrets stay in sessionStorage under separate account/guest-source namespaces, with digests and order references only.

Browser Web Locks serialize supported same-origin guest operations. Network catalog resolution happens outside that lock, followed by an observed revision check before writing. Without Web Locks, localStorage provides best-effort optimistic conflict detection; it cannot promise atomic cross-tab compare-and-swap. SQL checkout/source guards remain authoritative even when browser coordination fails.

If a write fails while stale disk data remains readable, newer in-memory changes stay in this tab; refresh never overwrites them with that stale disk copy. The UI reports the limitation and offers retry. Retrying storage refuses to overwrite a competing durable cart. Guest checkout requires a durably saved source/cart before submission; a customer can enable storage or sign in and explicitly merge into an account. Account checkout does not require independent guest storage to succeed.

Checkout receipt handling is a two-step protocol. After an authorized response confirms accepted COD, paid status or closure, the guest controller first durably saves its quantity cleanup or retained-item closure plus ackPending. Only then does it call `ack-cart`. The server locks the order, checks its actual terminal/accepted state and records cartAcknowledgedAt; acknowledgement never confirms payment. After success, the browser records previousReceiptId. Repeated cleanup is idempotent by the monotonic settled version. Concurrent trusted receipt cleanup can retry observed revision conflicts; uncertain quantity increments cannot.

A guest source may have only one unacknowledged server receipt. A source advisory lock and partial unique index prevent different attempt tokens creating concurrent duplicate orders. A later checkout must reference the last acknowledged receipt and use a larger cart version. Source ID alone never authorizes order lookup or reveals a previous order ID. A missing or rolled-back receipt history requires the original checkout session/receipt; the application does not silently replace the source to bypass that guard.

If storage fails after the order was saved, keep the original tab open. Cleanup/acknowledgement remains pending and blocks another guest checkout until it is durably saved. No browser implementation can recover a deliberately deleted capability or cleared storage without another authorized account/receipt; the UI explains the original-session requirement rather than inventing ownership.

## Lost responses and authorization

`POST /api/checkout/attempt` accepts the original 256-bit secret plus expected owner/source, hashes it for lookup and requires the actual current session to match the expected identity. It returns receipt status and validated cart lineage only, not shipping/contact data, token hashes or the raw secret. It renews the existing path-scoped HttpOnly confirmation/resume cookies. Wrong secrets, sources and accounts cannot recover a receipt.

A logged-in different regular account cannot use a leftover guest capability cookie. Use the original account or original guest session; the application never automatically logs a customer out or transfers the guest order. Guest secrets remain associated with their original source until the receipt advances, even if address/cart/payment inputs change after an unknown response. A 404 lookup does not prove an earlier in-flight request cannot commit; keep the same secret when retrying.

Order creation returns committed success even if post-commit cache invalidation or cookie writing fails. A cookie failure explicitly requests receipt recovery; it does not invite another order. Confirmation/recovery components pass authorized server lineage into cleanup, preserve unrelated cart items, and clear only the completed attempt namespace after receipt handling succeeds.

## Explicit guest merge and legacy review

Login never automatically merges guest items. The customer can explicitly merge into the currently verified account. For a product present in both carts, merge keeps the larger quantity rather than summing, so retry cannot add twice. The account coupon stays unchanged. Hidden/overstock/cap-limited products are reported and retained. Only acknowledged guest lines with the exact captured line ID, revision and quantity are removed from browser storage; a concurrently changed line remains for further review.

The older `amar-gadget-cart` cache is quarantined because it has no verified owner. Its cached names, prices and images are never displayed or submitted as current product data. The root review offers current catalog preview, explicit quantity correction, bounded row selection/import, pending-order review and separate whole-cache discard confirmation. Row pages show 25 rows; import accepts up to 100 chosen rows and uses larger quantities for duplicates. A requested older coupon is restored only by explicit selection, without replacing a different existing guest coupon.

Malformed/oversized data, invalid IDs, unsupported quantities, unavailable products and unselected rows remain intact. The parser bounds the raw document at 1 MiB and 10,000 rows; oversized documents require explicit review/discard rather than silent truncation. Pending/malformed receipt references block import until handled. An older receipt must be fetched through the existing authorized checkout API and actually accepted/paid or closed before its legacy reference is resolved. Paid quantities are subtracted only with matching captured product and line IDs; missing lineage is never fabricated. Old coupons lack an intent revision and remain for explicit review.

Modern guest persistence must succeed before older rows are removed. The two localStorage keys are not an atomic database transaction. If cleanup fails, old rows remain and a repeated max-quantity import is safe. Another tab changing the old raw document rejects stale cleanup instead of deleting its newer data. Account saving remains a separate explicit merge after guest restoration.

## API and SQL rollout

| Endpoint | Contract |
| --- | --- |
| `GET /api/cart` | Current session + matching X-Cart-Owner; private/no-store current cart, revisions and linked receipts; no owner/query selectors |
| `POST /api/cart` | Strict set/remove/clear/coupon/merge mutation; observed version and request UUID; bounded 16 KiB body |
| `POST /api/cart/guest` | Public bounded ID/quantity resolution; no account persistence or caller prices; current public metadata only |
| `POST /api/checkout/attempt` | Original secret, expected owner/source; bounded 1 KiB body; private/no-store receipt recovery and scoped cookies |
| `POST /api/checkout/[orderId]` with `ack-cart` | Existing order authorization; accepted/paid/closed guest receipt acknowledgement only |

Read/write/IP/account budgets are enforced at the actual APIs. Cart responses remain private/no-store, with expected-owner preconditions for queued identity changes. The deployment's existing Origin, signed ingress and role/session protections remain required.

Apply reviewed migrations `20261029150000_cart_persistence` then `20261029160000_guest_cart_receipts` to a backed-up intended database through the normal approved rollout. They add Cart/CartLine, exact bounded checkout JSON constraints, consumption/acknowledgement markers, request-receipt checks, uniqueness and query indexes. The second migration preserves the earlier six-key JSON shape and accepts the new previousReceiptId field; existing orders have null lineage/markers and are not automatically associated with browser caches. No production migration or reset is part of this contribution.

The application's runtime readiness requires both migrations. Deploy compatible application/schema together; retain the earlier snapshots and do not reset a populated database to adopt this feature. Product deletion behavior must continue respecting CartLine's deliberate soft-reference policy.

## Reproduction and evidence

Use only a disposable local `audit_*` PostgreSQL database. The test harness rejects external hosts and query overrides, and substitutes a closed loopback port when SQL tests are not explicitly enabled.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://codex_audit@127.0.0.1:55439/audit_amar_gadget_cart'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_URL = $env:TEST_DATABASE_URL
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:cart
npm run smoke:wishlist
npm run smoke:saved-addresses
git diff --check
```

Actual SQL/handler tests cover current metadata, owner/session isolation, stale edits/request receipts, merge/stock limits, hidden/deleted references, COD partial consumption, signed Stripe duplicates, re-added lines/extra quantities/coupon intent, cancellation/late payment, real lock contention, guest source concurrency, acknowledgement authorization, secret recovery, cookie/cache failure and SQL shape constraints. A fresh disposable database rehearsal preserves existing orders and a six-key receipt through both new migrations and verifies cart defaults, indexes, uniqueness and malformed-data rejection.

Controller/DOM tests explicitly mock HTTP/storage boundaries. They cover account transitions/late results, tab-only persistence, cross-tab revision conflicts, legacy import/repair/recovery, exact quantity/receipt handling, original-token namespaces, quote/coupon races, actual mounted cart/checkout/confirmation/wishlist views and root bridge lifecycle/Strict Mode. They are not a live-browser walkthrough.

The prepared-server smoke uses the built standalone artifact, real login/SQL and two sessions for one account plus another account. It exercises the actual cart APIs, current price/stock refresh, max merge, expected-owner conflicts, compiled COD/Stripe order actions, a real SDK-signed local webhook, guest source deduplication/secret recovery/acknowledgement, private headers, Origin/ingress and copied-cookie revocation. Its Stripe signature/event is an isolated local protocol fixture, not a hosted card charge. Actual browser/provider/deployment release checks remain AUD-044; SMTP revocation remains AUD-051 until the owner confirms it.
