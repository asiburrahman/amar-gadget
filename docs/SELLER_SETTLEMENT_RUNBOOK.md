# Seller settlement and administrator-recorded payouts

AUD-032 provides dynamic commercial terms, captured purchase policies, immediate delivered/collected shipment availability, an immutable earnings ledger and reserved externally confirmed payouts. All money is BDT, stored/calculated as integer paisa and exposed as decimal strings. This application records administrator-initiated external transfers; it does not send a bank/mobile-wallet payout automatically.

## Configure real commercial terms

Open `/admin/settlements` and choose **Commercial policies**. With an empty owner filter, review the GLOBAL policy. Set the actual commission percentage (0–100, up to two decimal places), choose SELLER or PLATFORM as shipping recipient, supply an audit reason and confirm the displayed revision. No default commission is invented.

Filter by an exact catalog-owner ID to configure a seller override or explicitly restore global inheritance. The directory in Overview supplies actual owner IDs and balances. Policy history is append-only and revision checked. Settings apply to future purchases; they do not rewrite captured terms on old shipments.

Every new shipment captures the effective policy ID at creation. Existing shipments at migration 28, or purchases made without configured terms, keep an explicit missing-policy hold. Configuring a later policy does not silently pay them. In **Shipment earnings**, review a missing-policy shipment and its currently effective policy, then explicitly adopt the reviewed terms once with a reason and observed snapshot revision. Adoption may release earnings immediately when pricing, delivery and collection are already valid. Captured terms cannot subsequently be replaced. Reconcile missing historic purchase pricing through the [refund/financial reconciliation workflow](REFUND_RECONCILIATION_RUNBOOK.md) rather than using current product prices.

## Understand availability and allocation

- Commission uses the shipment's remaining, discount-adjusted purchased goods, excludes shipping and rounds half up once per shipment. Refunds reverse the associated commission using retained purchase values.
- Original discount-adjusted goods allocate a multi-vendor order's shipping proportionally. Fully discounted goods use original gross goods as weights. Largest remainders with stable IDs conserve every paisa. Refunded shipping follows those original shares. Each captured policy independently assigns its shipment share to seller or platform.
- A delivered COD shipment becomes available when its collection is administrator-confirmed, even while another vendor is unpaid. Card shipments require verified PAID order state.
- Active refunds/disputes and recorded financial/reservation reviews withdraw availability. Actual confirmed refunds and provider loss adjust remaining entitlement. Provider losses reduce remaining goods/shipping before commission; excess order-level loss is shown separately for review rather than silently charged beyond allocated funds.
- A refund or loss after external payout can make a wallet negative. This is a seller receivable. New earnings offset it; new payouts cannot exceed positive available balance. A reserve is already deducted from availability, so confirming it never debits the wallet twice.

Overview separates available positive balances, seller receivables, outstanding reservations, confirmed external payouts and current entitlement. Potential amounts under known terms include holds and are not transferable; missing pricing/terms are explicitly counted. Monthly analytics use the last 12 posting months in Asia/Dhaka, including signed hold/refund/release changes and the actual confirmation month for external payouts. They are not order-placement sales cohorts.

## Reserve and resolve a payout

1. In Overview, review an actual verified/approved catalog owner and choose **Reserve payout**. Enter the exact BDT amount, actual external payment method and reason, then confirm. The server locks and rechecks current balance. Competing reservations cannot overspend. Review the saved RESERVED instruction before moving money outside the application.
2. After the external transfer actually occurred, open Payouts and **Record transfer** using the saved payout revision and its actual transaction/reference. The reserved seller, amount and method cannot be edited during confirmation. Method/reference normalization prevents duplicate confirmation of the same external reference. The application records PAID with administrator, reason and UTC time; it does not initiate another transfer.
3. If no money was sent, choose **Cancel unsent payout**, explicitly declare that no money was sent, supply a reason and confirm. The reservation is released once. PAID/CANCELLED instructions cannot be re-resolved or deleted. If a refund happened while the payout was reserved, recording an actual completed transfer still records the truth and retains any resulting debt.

## Recover an interrupted operation

The administrator UI saves the exact request UUID/body in session storage **before sending it**. It is scoped to the authenticated account and survives reload of that tab. If storage cannot preserve the intent, nothing is sent. Account changes abort pending requests and remove the previous owner's private UI; another account does not load that saved intent.

Reload the original receipt or retry the exact saved intent. Retrying never substitutes new fields or a new UUID. A saved receipt is scoped to its originating administrator and remains discoverable outside current display filters. A recorded change is followed by a real saved-state reload; cache-refresh failure cannot convert a committed mutation into a false failure.

There is no unsafe local discard. **Resolve original request on server** serializes against that UUID: it returns the already committed original result, or records an immutable ABANDONED receipt under the original hash so a delayed original request cannot execute later. This stops an unexecuted intent; it does not undo an already committed payout/transfer. An unresolved or invalid local intent blocks new financial operations in that tab until its authoritative state is recovered. Session storage is not a substitute for reviewing server payout history after a tab/browser is lost.

## Pages, API and evidence

Administrator management is `/admin/settlements`. Seller views are `/member/earnings`, `/member/payouts` and `/member/analytics`, with links from seller navigation/dashboard. Sellers have scoped read-only access; administrators use their dedicated finance page. Unapproved sellers cannot load private settlement views.

`GET /api/settlements` supports overview, policies, shipments, ledger and payouts with real 20-record pages and whole-scope aggregates. `POST` accepts strict administrator policy/adoption/payout/recovery operations. `X-Settlement-Owner` identifies the expected current viewer, never the seller being impersonated. Current database role, verification and session revision are rechecked under lock. Responses are private/no-store; body size, rate, query and field validation are bounded. Mutation receipts bind the administrator and canonical payload hash. Raw financial/provider/database diagnostics are not returned to clients.

PostgreSQL projects final transaction state into SellerAccrual and posts immutable SellerLedgerEntry deltas. Wallet balances must match that ledger, and accrual targets must match purchase/fulfillment truth. Order writers take Order before accounts and wallets; payout reservation locks its wallet without later taking an order lock. Posted purchase/fulfillment evidence, payout instructions/events and request receipts are retained. No direct client-supplied balance, identity or payment status can create available money.

## Migration and reproduction

Reviewed migrations 28–31:

- `20261103090000_settlement_policy_snapshots`
- `20261103100000_settlement_projection`
- `20261103103000_settlement_partial_order_states`
- `20261103110000_seller_ledger_payouts`

Migration 30 preserves applied SQL history while allowing the existing PARTIALLY_SHIPPED/PARTIALLY_DELIVERED aggregate order states; individual delivered/collected vendors must not wait for the other vendor. Readiness requires migration 31. Fresh installation and legacy upgrade are rehearsed on isolated local databases; the legacy rehearsal verifies unchanged paid purchase data, a missing-policy hold after migration and explicit later adoption. No production migration or deployment was performed. Apply production changes only through the reviewed, backed-up rollout process.

Use a disposable local `audit_*` database with TEST_DATABASE_URL, DATABASE_URL and DIRECT_URL set appropriately:

```powershell
npx prisma migrate deploy
npx prisma generate
npx jest --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:settlements
npm run smoke:refunds
npm run smoke:fulfillments
```

The native settlement smoke creates/migrates its own random database, uses real cookies, signed ingress, the prepared Next server, compiled checkout and actual SQL/HTTP mutation paths, then drops only that newly created fixture. Controlled Redis/provider fixtures are test infrastructure. The full implementation log records exact check results. Interactive-browser and actual hosted-provider certification remain AUD-044; local tests do not certify real external money movement.
