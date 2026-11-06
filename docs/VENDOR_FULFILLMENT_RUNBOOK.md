# Vendor fulfillment and COD receipt

AUD-014, 30 October 2026. Work stays on `codex/deep-audit-2026-10-28`.

## Confirmed operating rule

The owner selected this COD rule: an administrator marks each vendor shipment delivered and explicitly confirms receiving that shipment's COD money. The order becomes PAID only when every nonempty shipment is delivered and collected. A partially delivered order remains UNPAID while its collected shipment can independently qualify as a verified purchase.

Sellers manage their own packages at `/member/orders` or the orders tab of their dashboard. They enter a real carrier and package tracking number, then mark a PROCESSING shipment SHIPPED. They can correct active tracking details. An administrator opens **Manage vendor shipments** on `/admin/orders`, confirms actual delivery and, for COD, checks the money-received acknowledgement. Delivery requires SHIPPED; sellers cannot confirm delivery or collection. Stripe fulfillment requires verified PAID card payment and no outstanding payment reconciliation. Card delivery does not accept a COD collection assertion.

Legacy DELIVERED COD shipments without recorded collection have a separate administrator collection confirmation. It records the actual new collection time without manufacturing an earlier delivery time. Earlier PAID/DELIVERED COD orders preserve the previously recorded payment fact; their migration snapshot does not invent a collection timestamp.

## Ownership, revisions and state

An OrderFulfillment belongs to one order and one captured seller. Every OrderItem receives its shipment assignment inside the order transaction. Assignment and seller identity cannot be moved afterward. Changing a catalog owner later does not move earlier purchased lines or grant the new owner access to those packages.

Seller reads use these assignments, select only that seller's lines and necessary checkout recipient address/phone, and omit buyer account IDs/emails, other vendors' lines and the order grand total. The displayed item subtotal is explicitly before order-level discounts; settlement, commissions, refunds and financial reporting remain AUD-015/032/034 work.

The strict mutation API requires a UUID shipment ID and the revision actually observed by the caller. The authenticated actor comes from the current session; role, verification, seller approval and sessionVersion are checked again under a database lock. Lock order is Order, User, shipment, then sorted Products when review aggregates need reconciliation. An expected-owner header rejects a request left open under another account. Competing revisions cannot silently overwrite each other.

The aggregate states are PENDING, PROCESSING, PARTIALLY_SHIPPED, SHIPPED, PARTIALLY_DELIVERED, DELIVERED and CANCELLED. Every nonempty shipment contributes. One package cannot advance its sibling. Mixed cancelled/noncancelled groups require reconciliation and are rejected in this phase. Carrier/tracking fields on a single-vendor order mirror its package; mixed orders have no misleading global carrier/tracking pair.

Whole-order controls only confirm a pending eligible order or cancel an unpaid order before any shipment has dispatched. Cancellation locks the order and checks its observed aggregate revision, restores reserved quantities once and cancels all groups atomically. Paid orders require the refund workflow. Stripe cancellation requires positive provider-expiry/no-session evidence; provider calls run outside SQL, then stock release rechecks the original administrator session/revision under the order lock. Signed provider payment truth remains recordable even when the initiating administrator changes.

## API and UI contracts

* `GET /api/member/fulfillments`: approved seller's own shipments.
* `GET /api/admin/fulfillments`: administrator shipment list with vendor context.
* Both list APIs accept strict `page`, `status` and optional `orderId`. Page size is 20, with stable date/ID ordering, exact counts and bounded out-of-range handling.
* Both POST endpoints accept `ship` or `tracking` with carrier/tracking fields. `deliver` requires `codMoneyReceived: true` for COD and `false` for card. `collect-cod` requires `true` and a delivered, uncollected COD package. The latter two actions require ADMIN.
* `GET /api/fulfillments/[id]/history` checks current ownership/admin authority, accepts an optional shipment-bound UUID cursor and returns at most 50 events. Seller history omits actor IDs.
* All these requests require `X-Fulfillment-Owner` matching the current account and return `Cache-Control: private, no-store`. Writes have distributed per-IP/per-account limits and a 16 KiB decoded JSON bound; duplicate query fields and unknown query/body fields fail validation. Ingress and same-origin enforcement remain the existing gateway/proxy boundaries.

Forms retain failed tracking drafts, block duplicate requests, require reload after uncertain results and require explicit rebase when a saved revision changed. COD acknowledgement is bound to the displayed revision. Account-keyed components abort requests and ignore late results after logout/account changes. Lists distinguish failures from empty results. Successful writes refresh shipment counts and server-rendered order state. Customer order history, confirmation/resume and phone-verified public tracking show individual packages and partial aggregate labels.

The former whole-order shipment action is no longer a versionless shipping path. Its adapter requires the package ID, owner, revision and tracking fields. Administrator whole-order delivered/shipped calls are rejected; delivery is package-specific.

## History and verified purchases

Shipment events are append-only with actual actor/role, revision-associated changes, carrier/tracking, COD receipt fact and occurrence time. An order's existing history also gains package events. Separate package and aggregate events can occur in one transaction; they describe different facts. Legacy snapshots explicitly have no invented transition time. Both new package and aggregate event instants use UTC independent of PostgreSQL's session timezone. The follow-up UTC migration leaves historical events intact because their original session timezone is unknown.

Review selection, review database guards, publication filtering, aggregates and bestseller unit counts now use delivered-and-paid **item shipments**. COD needs that shipment's collection fact; Stripe needs the order's provider-confirmed PAID state. An undelivered sibling neither qualifies early nor prevents a completed sibling's review. Delivery/collection reconciles affected product ratings in the same transaction. Refund work must integrate the same review reconciliation before changing purchase eligibility.

## Migration and rollout

`20261030130000_vendor_fulfillments` creates shipment/event storage, indexes, identity/revision/transition constraints, item binding, deferred aggregate checks and integration with existing verified-payment/reservation writers. Backfill uses each historical product's currently recorded seller because the earlier schema did not store order-time seller identity. Operators who previously reassigned products directly in SQL must review that attribution before rollout. The migration refuses unsupported historical order states. Existing order/item history is retained; mixed-order carrier details move to each legacy package and remain in the earlier history.

`20261030140000_fulfillment_event_utc` makes new aggregate event instants UTC. Readiness requires migration 21. Both migrations were applied only to an isolated local audit database. The fresh-database rehearsal upgrades the earlier schema with actual mixed-vendor history and verifies immutable assignments, seller transfer behavior, rollback, aggregate constraints, card-state synchronization and cascade cleanup. Production rollout still needs an operator's backup, historical attribution/state review, migration approval and the matching application artifact. No production database has been migrated by this task.

## Reproduce local checks

Use a disposable localhost database whose name starts with `audit_`. Set DATABASE_URL, DIRECT_URL and TEST_DATABASE_URL to that same fixture before applying migrations or running tests. Never reuse production data or credentials.

```powershell
npx prisma migrate deploy
npx prisma generate
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:fulfillments
npm run smoke:reviews
npm run smoke:cart
git diff --check
```

The fulfillment smoke runs the prepared production artifact with real HTTP, current cookies, compiled checkout actions and real PostgreSQL. It purchases a mixed-seller cart, verifies seller isolation, ships independently, denies seller/unconfirmed COD delivery, checks partial collected-purchase eligibility and public tracking, completes collection, then verifies a locally signed Stripe webhook and card shipment, actual role pages and copied-session revocation. Redis and Stripe event data are isolated test fixtures. No hosted charge, real parcel delivery, external COD receipt, deployment or interactive-browser certification is implied. Release/browser verification stays in AUD-044; the owner's SMTP revocation remains AUD-051.
