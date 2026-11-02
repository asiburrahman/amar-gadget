# Refunds, returns and financial reconciliation

AUD-015 implementation, 2 November 2026. Branch: `codex/deep-audit-2026-10-28`. This document records implemented behavior and local evidence; it does not certify hosted payments, deployment or the unfinished settlement/reporting work.

## Approved policy

The owner approved both full-remaining-order and selected-item/quantity refunds. Before dispatch, refund the goods and applicable shipping and restore their reserved stock. After dispatch, exclude shipping; restore stock only when an administrator physically receives, inspects and accepts the returned units. For COD, an administrator sends money outside the application, then records the actual method/reference and explicitly confirms repayment. The form never initiates a COD transfer.

For partial requests, shipping is apportioned from the remaining refundable shipping in proportion to selected undispatched net goods versus all remaining net goods. A full request with every remaining item undispatched includes all remaining shipping. Mixed requests include only the undispatched share. Integer arithmetic preserves every paisa, including final-unit remainders. Refunds cannot exceed captured money, purchased quantities or remaining item value.

## Administrator and customer flows

Open `/admin/orders`, choose an order's refund controls, and reload its saved financial state. Choose all remaining goods or item quantities, supply the reason, obtain the server preview and submit that observed revision. Prices, discount allocations, shipping and transfer amount come from the saved purchase, never a browser-supplied amount or today's catalog price.

Stripe requests have durable intents. The administrator can process/reconcile an intent, and the supervised worker can continue an already approved intent. A request is not a confirmed refund: QUEUED, SUBMITTING, PENDING, REQUIRES_ACTION and REVIEW retain their actual meanings. Confirmed money, shipment holds, stock and reviews change transactionally when the configured provider confirms success. Definite provider failure releases the active intent without pretending money moved.

For COD, confirm the specific queued intent using CASH/BKASH/NAGAD/BANK/OTHER, a real transaction/receipt reference and the explicit repayment checkbox. Only collected shipments are refundable. A positive COD repayment reference cannot be reused for another refund under the same method. A post-dispatch refund does not restock anything. Use the separate inspected-return form after physical receipt; its original UUID deduplicates retries and over-return is rejected.

Customer order history has a private, lazy refund-history view and safe summary. Order confirmation/tracking retain original purchase amounts and show confirmed refunds and dispute/review state separately. Seller views exclude fully voided units and show retained net line values. Administrator revenue deducts confirmed refunds and actual lost dispute principal. AUD-034's [dashboard aggregate definitions](DASHBOARD_METRICS_RUNBOOK.md) now cover customer all-time and seller month cohorts. Seller commission/payout availability remain AUD-032; comprehensive administrator reports remain AUD-030.

Changing account, role or order replaces the console lifetime and aborts prior requests. Uncertain writes preserve typed details and their original intent UUID. Reload searches that exact saved receipt before allowing the original attempt to be retried or discarded. A changed order/item revision requires a new reviewed decision. A new server render does not erase an open administrator refund draft.

## Historical purchase pricing

New checkouts store immutable subtotal, allocated order discount, shipping and per-line net amounts. Largest-remainder allocation resolves fractional discount shares with a stable item identity tie-break. SQL verifies that the line totals and order capture reconcile exactly.

Earlier orders lack a trustworthy shipping/discount breakdown. They require an administrator to verify original shipping from purchase evidence/reference. The service derives the discount from stored purchased prices and the recorded order total. It rejects an impossible breakdown and freezes accepted pricing. Do not infer historical shipping from current site configuration. Missing original Stripe payment/session references are held for operator investigation; no fabricated capture is accepted.

## Durable provider processing

Every intent has a client request UUID, canonical request hash, immutable allocation and a stable provider idempotency key `amar-refund-<refund-id>`. Duplicate exact requests recover the existing intent even after a response is lost. Concurrent intents, stale revisions, revoked sessions and competing workers are serialized with database locks, a unique active-intent constraint and provider-work leases.

Provider calls happen outside database transactions. Before first submission, the service verifies the actual succeeded payment, BDT currency, original amount, order metadata, paid charge and absence of dispute. It lists the current refund history before creating money movement, checks saved metadata, rechecks the current order/administrator authority and records submission before issuing the SDK request. Unknown existing provider refunds are imported for reconciliation first.

The provider-create safety cutoff is conservatively 23 hours after an uncertain submission. It prevents an old request from being blindly recreated after the provider's idempotency retention. After 24 hours, an administrator can document recovery evidence and explicitly check complete bounded provider history. A matching transfer is reconciled; a positively missing attempt is closed, allowing a separately reviewed new intent. Provider/API uncertainty never proves absence. See [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) and [refund creation](https://docs.stripe.com/api/refunds/create).

Signed refund/dispute webhooks retrieve current provider objects. Duplicate receipts are immutable and events busy with an active lease remain retryable. Events can arrive out of order; an old webhook snapshot cannot change current provider truth. A `charge.refunded` pass imports a bounded number of changed operations and defers remaining work. See [Stripe webhook ordering](https://docs.stripe.com/webhooks) and [refund lifecycle](https://docs.stripe.com/refunds).

The original capture stays PAID; `refundState`, confirmed refunded cents and retained item quantities/value are separate financial facts. This prevents a late capture webhook from erasing refund history. Pending money is never counted as returned. A later failed/reversed previously successful provider refund removes its confirmed money while preserving physical stock already released. The order is held for review; after the administrator acknowledges the provider reversal, any voided-item repayment debt keeps it held until a replacement refund covers that debt. Inventory is not restored a second time.

External provider refunds count as actual returned money immediately after verification, but require administrator attribution to item amounts/quantities and shipping. Attribution must exactly equal provider money and cannot overrun remaining purchase values. Quantity-zero amount adjustments are supported. No automatic external quantity or stock guess occurs. Disputes retain current provider status and actual lost principal; active/lost disputes hold fulfillment/refunds and verified-review eligibility. Won disputes restore eligible purchases. Dispute evidence submission is handled in Stripe Dashboard; this application records the current outcome. See [Stripe dispute object](https://docs.stripe.com/api/disputes/object).

## Worker and deployment configuration

Run `npm run worker:refunds` as a separate supervised process using the same release and database target as the web application. The standalone preparation script packages the worker and ingress protocol. Configure these privately:

| Variable | Purpose |
| --- | --- |
| `CHECKOUT_SWEEP_ORIGIN` | Reachable application/gateway origin for the worker |
| `APP_URL` | Canonical application origin used to sign ingress |
| `TRUSTED_PROXY_SECRET` | Trusted ingress signature key |
| `CHECKOUT_SWEEP_SECRET` | Independent maintenance Bearer key, distinct from the ingress key |
| `CHECKOUT_SWEEP_DATABASE` | Exact expected current database name, also used by the checkout worker |
| `STRIPE_SECRET_KEY` | Configured provider account secret on the web service |
| `STRIPE_WEBHOOK_SECRET` | Signature verification secret for that configured endpoint |

The worker calls only `POST /api/internal/refunds/reconcile` with both the scoped ingress signature and independent Bearer authentication. The endpoint checks its actual database name before processing two due intents; worker loops wait sixty seconds. Leases recover crashed passes. The endpoint reports checked/reconciled/deferred/error counts rather than claiming a busy pass completed. Observe operator errors and REVIEW intents; do not silence them or create replacement intents to bypass a hold. Configure HTTPS outside loopback. Keep signed refund/dispute events enabled for timely pending, external and terminal updates; the worker primarily resumes due active intents, not every historical completed transfer.

## Storage and migration

Migration `20261030150000_refund_ledger` is migration 22 and is required by readiness. Apply checked-in migrations to a disposable local database first. Production needs its own reviewed backup/rollout; this work has not migrated production.

Refunds, allocation lines, return receipts, webhook receipts and financial events retain immutable identities and evidence. Restrictive foreign keys and SQL guards prevent erasing financial evidence or editing confirmed transfer proofs. Deferred constraints reconcile successful refund totals, line quantities/money, physical return receipts and order counters. Item retained quantity/value is derived by SQL. Payment/dispute/refund state changes invalidate stale quotes; refund-induced shipment adjustments have truthful system/admin history labels. Order/package and sorted product locks keep stock, eligibility, ratings and financial changes atomic.

These records are intentionally not removable with ordinary fixture row cleanup. The new financial suites/smoke create their own random, local `audit_*` databases and drop only the database that specific invocation created. They do not reset/delete/migrate the supplied database. Existing isolated migration history is preserved.

## Reproduce local verification

Provide an isolated local PostgreSQL `audit_*` database and point both Prisma URLs at it. Never use production credentials/data. Then:

```powershell
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:DIRECT_URL = $env:DATABASE_URL
npx prisma migrate deploy
npx prisma generate
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npx prisma migrate status
npm run build
npm run smoke:refunds
npm run smoke:fulfillments
npm run smoke:cart
npm run smoke:reviews
node --test tests/native/ingress-gateway.test.mjs
git diff --check
```

Financial integration tests use real PostgreSQL, actual SQL constraints, stock/session revisions, SDK signature verification and configured current application services. Provider transport is controlled only at the test boundary. DOM cases use the real console/hook to exercise StrictMode, server previews, preserved uncertain drafts, receipt recovery, exact-UUID retry, COD affirmation, customer controls and account-switch cancellation.

The compiled-server financial smoke creates its own migrated database, seeds explicit purchased-order fixtures, performs actual HTTP login/private routes, and sends real Stripe SDK requests through an exact loopback-only transport preload. The local provider verifies SDK authentication, idempotency metadata and remaining capture bounds. The smoke verifies partial/full refunds, signed stale-snapshot webhooks using current objects, actual maintenance authentication, COD collection/repayment and exactly-once inspected returns. The preload and provider exist only under `scripts/testing`; there is no application provider-host override or demo success path. Existing checkout/cart/fulfillment/review smokes separately exercise compiled purchase creation.

Recorded final checkpoint: **751 tests in 81 Jest suites passed** with isolated PostgreSQL enabled, including eighteen financial integration cases, the legacy upgrade rehearsal, policy and client tests. TypeScript, Prisma validation, all twenty-two migration status checks, production build and staged diff checks passed. Changed-file ESLint has zero errors and two existing native-image warnings. All seven native ingress/worker tests passed. The compiled refund, fulfillment, cart and review smokes passed.

Hosted Stripe operations, real COD repayment, real courier returns, a production database upgrade and interactive-browser certification remain operator/release checks. No actual external payment, refund or credential change was performed. SMTP credential revocation remains AUD-051.
