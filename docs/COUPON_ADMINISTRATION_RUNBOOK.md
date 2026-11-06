# Coupon administration (AUD-028)

Administrator path: `/admin/coupons`. Private API: `GET/POST /api/admin/coupons`. This replaces the former placeholder with saved coupon rules, create/edit, explicit activation/deactivation, search/status filters, bounded pagination, revision reload, draft preview and retained change history. Deletion is intentionally absent: deactivate a promotion to stop new use while retaining its evidence.

## Rules and purchase pricing

Codes are trimmed and uppercase, 1–64 characters without control characters. Discounts are positive BDT amounts or percentages up to 100, with at most two decimal places. Minimum spend is optional and nonnegative; equality qualifies. Expiry is optional, entered and displayed in UTC with millisecond preservation. At the expiry instant the coupon is unavailable. An inactive coupon remains unavailable even without expiry; an active expired coupon is shown as EXPIRED until its saved expiry is explicitly changed.

The administrator preview and actual checkout use `lib/coupon-policy.ts`. Enter the subtotal **after product discounts**, before coupon and shipping. Fixed discounts are capped at the subtotal; percentage discounts round half up to two decimals. Shipping is the existing checkout policy: BDT 150 for a positive subtotal through BDT 50,000, zero above that threshold or at zero. Coupon discounts do not alter that shipping threshold. Stripe requires a final total of at least BDT 1, and the supported order maximum is BDT 99,999,999.99. This task does not change shipping policy.

Preview evaluates the actual draft, including active/expiry/minimum-spend restrictions, at the server's current time. It writes no coupon or receipt and does not reserve stock. Editing any draft/preview input clears its displayed result. Actual checkout queries current approved products/sellers, price, stock and saved coupon, and revalidates the quote fingerprint before purchase.

Coupon rule edits affect future purchases. Existing orders retain their original code and subtotal/discount/shipping/line allocations. A code referenced by any saved order, including an unpaid order, cannot be renamed or deleted. Create a new code for a new promotion identity. An unused code can be renamed with its current revision. No usage cap or one-use-per-account rule is implied by the saved order count.

## Authority, concurrency and uncertain responses

Every API request requires a current verified ADMIN session and the observed `X-Coupon-Owner`. IP/account limits, strict query/body validation and a 16 KiB decoded body limit apply. Responses are `private, no-store`; errors do not publish database/private request contents. Mutations lock and recheck current account/session authority before changing data. SQL lock/statement/transaction timeouts bound waits.

Writes carry a random request UUID; updates and activation also carry the observed coupon revision. Exact retries return the original receipt identity plus the current saved record. Reusing an identity with different content or another owner is rejected. Receipt and history rows are append-only. History records before/after state, actor, UTC recording instant and a monotonic sequence, with 20 entries per page.

Actual order creation holds a coupon share lock through its transaction. Administrator edits take an exclusive row lock. A checkout winning first keeps its original purchase snapshot; a later rename sees its saved order and is rejected. An edit winning first is observed by checkout, which rejects unavailable coupons or a changed quote. Administrator edits also serialize against one another and reject stale revisions.

After an unconfirmed write, the console keeps the exact original body and draft. Reload saved coupons/receipt first. A recorded receipt loads its **current** saved record without repeating the write. If the receipt is absent, retry uses the identical UUID/body, or the operator may discard the unrecorded intent. List reload does not silently overwrite an open draft. Loading a newer revision explicitly replaces its fields. Account changes unmount the workspace, abort outstanding requests and reject late responses.

## Migration and rollout

Migration `20261102100000_coupon_administration` adds coupon revisions/update timestamps, request receipts, ordered immutable history, code/range checks, purchased-code guards, order-code immutability and the order-code lookup index. Readiness requires all 24 checked-in migrations. Existing valid rules and order amounts are preserved. Migration defaults/history recording use UTC independently of the database session timezone.

Before deployment, back up the target database and review existing coupon codes/ranges. Noncanonical codes, nonpositive discounts, percentages above 100 or negative minimum spend cause the transactional migration to fail rather than silently changing benefits or merging identities. Reconcile affected rules and historical code references with the operator before a reviewed rollout. Do not edit a migration already applied to any database. Existing historical coupon edits cannot be reconstructed: the new history starts with subsequent changes.

No production migration or deployment is performed by this work. Hosted payment/email/browser release verification remains separate under AUD-044; external SMTP revocation remains AUD-051.

## Reproduction

Use a disposable local PostgreSQL database named `audit_*`; set `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL` to that same isolated database. Do not use production credentials or data.

```powershell
npx prisma migrate deploy
npx prisma generate
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npx prisma migrate status
npm run build
npm run smoke:coupons
npm run smoke:cart
npm run smoke:refunds
git diff --check
```

Migration rehearsals and financial integration/native suites create their own random local databases and drop only the database created by that invocation. They do not reset the supplied database or erase earlier failed fixtures. DOM tests explicitly replace HTTP at the test boundary; compiled smokes use actual password login, ingress/Origin enforcement, PostgreSQL, private handlers, the compiled Next server action and persisted cart/order snapshots. These are local protocol checks, distinct from interactive browser or hosted provider certification.

Recorded checkpoint: **818 tests across 92 Jest suites pass** with isolated PostgreSQL enabled. TypeScript, all changed-file ESLint, Prisma schema validation, all 24 migration status checks, production build and smoke-runner syntax checks pass. The compiled coupon smoke passes actual discounted-product preview/quote agreement, account cart consumption, immutable coupon-priced order snapshots, deactivation, original receipt/current-state recovery, used-code protection, audit history, private administrator page, Origin/owner/role and revoked-cookie guards. Existing compiled cart/COD/Stripe-webhook and refund/worker/manual-COD/inspected-return regressions pass. The migration rehearsal also proves invalid legacy rules roll back without modifying their benefits.
