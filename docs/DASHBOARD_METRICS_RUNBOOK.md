# Customer and seller dashboard metrics

AUD-034, 2 November 2026. These are purchase/payment measures, not seller settlement balances. AUD-032 still requires the owner's commission, shipping and payout policy. This independent metrics task was completed while those answers were pending; no original task was removed.

## Customer definitions

The customer dashboard uses the current verified database-backed session and queries only that account's orders. Every all-time card includes the full account history; the separate recent list contains at most ten orders and previews at most three item lines per order. Remaining lines are accessible through order details. Customer contact/address/provider credentials do not enter the dashboard DTO.

| Card | Definition |
| --- | --- |
| Total Orders Placed | Every order belonging to the account, including unpaid/cancelled orders. |
| Orders Awaiting Completion | Orders whose aggregate status is neither DELIVERED nor CANCELLED; includes unpaid pending orders and partial shipment/delivery. |
| Net Paid Order Value | For fully PAID orders, original total less confirmed successful refunds and actual lost dispute principal, floored at zero per order. Includes shipping. A late payment on a cancelled order remains actual received money until refunded. |
| Delivered Order Payments | The same net payment calculation, restricted to aggregate DELIVERED and PAID orders. Cancelled/unpaid/incomplete orders do not contribute. |

A COD order becomes fully PAID only when all applicable shipments have been delivered and collected. Partially collected COD orders have a separate visible count and are excluded from paid-order totals until that condition holds. This avoids inventing a customer-level allocation of shipping between partial collections. Seller item metrics can recognize that seller's actually collected package independently.

Pending refunds and active disputes are not confirmed returned money. The dashboard counts orders needing financial attention and explains that totals can change when an actual refund/dispute outcome arrives. Lost chargeback principal is deducted; processor fees are not invented as a customer refund. The original order amount, confirmed refund summary and delivered/payment state remain available in recent orders.

## Seller definitions

Seller aggregation follows `OrderItem.fulfillmentId -> OrderFulfillment.sellerId`, the immutable seller captured at purchase. Today's `Product.sellerId` or price cannot transfer earlier sales or reprice them. Queries return aggregates rather than sending every historical order line to the browser.

| Measure | Definition |
| --- | --- |
| Incoming Customer Orders | Distinct historical order IDs containing a line captured for this seller, including cancelled/unpaid history. |
| Orders Pending Delivery | Distinct order IDs with an own, active unfinished shipment and retained purchased quantity. Two lines in the same order still count once. |
| Reconciled Paid Item Value | Sum of retained line cents for noncancelled own shipments/orders with actual payment and a cleared financial state. STRIPE requires order PAID; COD requires that shipment's explicit collection. Unpaid/cancelled values are excluded. |
| Delivered Item Value After Refunds | The same calculation, restricted to that seller's DELIVERED shipments. A delivered/collected package can contribute while a sibling vendor's package is incomplete. |
| Retained delivered units | Purchased quantity minus confirmed refunded quantity on paid, delivered, financially clear own lines. Physical return receipts and financial refunds remain separate facts. |
| Paid lines awaiting reconciliation | Active paid lines with missing historical purchase pricing, reservation/financial review or active/lost disputes. Their money is excluded rather than guessed, and the count is visible. |

Purchase line `retainedCents` already contains the exact original order-discount allocation and confirmed attributed refunds. Item figures are before commission and exclude shipping. They are not credited earnings, withdrawable balances, bank receipts or settled payouts. Quantity-zero provider adjustments reduce money while preserving the recorded quantity policy. Unknown legacy pricing requires the existing evidenced refund-pricing reconciliation, not today's catalog price.

Current catalog totals still describe current owned products; they intentionally differ from captured historical sales ownership after a product transfer. The existing catalog list is separate from financial aggregation. Broader catalog maintenance/pagination and administrative reports remain their original scheduled tasks.

## Monthly cohorts and consistency

The monthly table groups by the original order placement timestamp, explicitly converted from stored UTC to `Asia/Dhaka`. This prevents server/browser/session timezone differences and item-created timestamps from moving an order into a different month. Each month's order count is distinct, even when an order contains several own products. Refunded values update the original purchase cohort; the table is not a statement of cash movement during the refund month.

Monthly output is bounded to twelve grouped rows for the selected year. The year route validates one four-digit value from 2000 through the current Dhaka calendar year; duplicated, malformed or future values show a reset link before financial queries. Previous/next-year links preserve access to earlier available cohorts. All-time cards remain independent of year selection. An empty year explicitly says no orders were placed in that year.

The financial service uses one bounded RepeatableRead transaction per dashboard snapshot. It locks/revalidates the current verified role/session and seller approval before reading aggregates. Customer summary and recent list share that snapshot, so a concurrent purchase cannot appear only in one side. Queries have statement/lock/transaction limits, parameterized identities and numeric safe-range checks. A database error is propagated to the existing error boundary; it is not rendered as a successful zero-order result.

Client views require the matching account/role; seller data additionally requires current approved seller status. Account changes, logout or suspension remove old dashboard values/catalog from the visible UI. New server props replace metrics directly rather than retaining an obsolete client-computed total. Existing per-package fulfillment controls continue to handle tracking and delivery.

## Verification and reproduction

Use only a disposable local PostgreSQL `audit_*` database with checked-in migrations, never production credentials/data:

```powershell
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:DIRECT_URL = $env:DATABASE_URL
npm test -- --runInBand
npx tsc --noEmit
npm run build
npm run smoke:dashboard-metrics
git diff --check
```

Recorded checks: **769 tests across 84 Jest suites pass** with real PostgreSQL enabled. New SQL cases cover more than ten customer orders, unpaid/cancelled/late-paid records, multi-line distinct order counts, exact discount allocation, confirmed quantity refunds, retained shipping, independent COD collection, historical unknown values, lost disputes, catalog ownership/price changes, the Dhaka month boundary, earlier-year cohorts, stale/unverified/blocked authority and concurrent snapshot consistency. UI/page cases cover authoritative totals, financial notices, year navigation, fresh server props, account changes, suspension, invalid query input and real failures rather than zero-value fallback.

The production build and TypeScript pass. Changed-file ESLint has zero errors and one existing seller-catalog native-image warning. The compiled-server smoke creates its own newly migrated local database, seeds fifteen explicit purchase fixtures, performs actual password login, actual per-shipment COD collection and recorded manual refund, and reads the actual server-component dashboard payload. It verifies exact all-time/recent totals, current refund/shipping values, distinct seller month cohorts, historical ownership after catalog transfer, invalid years, blocked-account token revocation, fresh-login account status and revoked customer access. DOM tests separately verify visible cards, account gating and navigation.

The installed Next.js version redirects RSC requests to the correct `_rsc` cache-key hash; the smoke follows only the same-origin/same-path framework redirect and signs the resulting exact target. Its first login rehearsal hit the existing expensive-password-work capacity under concurrent build/test load; serializing the runner's actual logins respects that guard. Its first blocked-seller assertion expected old-cookie status display, whereas the existing SQL security trigger revokes that cookie; the final smoke proves revocation and then checks status with a fresh password login. No application authentication or framework validation was weakened.

No migration was added for this task. Existing migration 22 was applied only to newly created local smoke/test databases. No production migration, deployment, hosted payment, real refund or interactive-browser certification occurred. Full browser/provider release validation and the other open audit tasks remain required.
