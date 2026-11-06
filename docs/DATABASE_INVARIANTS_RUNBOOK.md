# AUD-049: database invariants and rollout rehearsal

**Status: AUD-049 complete and CI-verified on b9cf24f, 6 November 2026.** The
tracked count is 50/51 after the local and PostgreSQL 16/18 CI gates passed.
AUD-051 is the separate, still-unconfirmed owner SMTP credential revocation.
No production migration, provider payment, deployment or main merge is claimed.

## Migration and compatibility

Migration 38, `20261105100000_database_invariants`, adds protections without
rewriting application rows. Migrations 1-37 remain unchanged. Its explicit
transaction takes a stable lock on User, Product, Order and OrderItem before
preflight, with a five-second lock timeout and 60-second statement timeout.
A busy or invalid database fails rather than waiting indefinitely or repairing
history. Large production datasets need a separately reviewed maintenance
window and rehearsal against a restored backup; local fixture timing is not a
production rollout estimate.

The exact same count query powers the migration preflight and the standalone
read-only operator command. Fourteen rules return aggregate affected-row counts;
no email, phone, credential, account identifier, tracking value or row contents
are printed. Duplicate tracking counts are affected orders, not duplicate groups.
Invalid rows raise SQLSTATE 23514 before any new protection is installed. The
whole DDL transaction rolls back; Prisma can retain its failed migration record.

| Relation | New protection and retained semantics |
| --- | --- |
| User | Roles USER/MEMBER/ADMIN; seller states APPROVED/PENDING/BLOCKED/REJECTED. No automatic role inference, account recreation or seller approval. |
| Product | PENDING_APPROVAL/APPROVED/REJECTED/ARCHIVED; price 0.01 through 99,999,999.99; optional discount at least 0.01 and strictly below price; nonnegative stock. Finite price bounds also reject PostgreSQL numeric NaN. |
| Order | Seven actual aggregate fulfillment states; COD/STRIPE; payment UNPAID/PAID/FAILED; total zero through 99,999,999.99. Zero-total retained orders remain valid. |
| Order tracking | Non-null codes unique, 1-120 characters, trimmed and without control characters. Existing historical formats remain valid; multiple NULL codes remain valid. |
| OrderItem | Positive quantity, nonnegative price through the same money maximum. No new 100-unit historical cap; retained zero-priced items are allowed. |
| Address | Existing partial unique `Address_one_default_per_user` retained: zero defaults and multiple nondefault addresses are valid. |
| Review | Existing partial unique `Review_one_canonical_user_product` retained. Historical noncanonical LEGACY duplicates, invalid historical ratings and long legacy text are retained under existing quarantine rules. |

New checkout tracking codes use 128 random bits (`AG-` plus 32 uppercase hex
characters). A maximum of three attempts retries the entire rolled-back creation
transaction only for the actual Prisma/PostgreSQL `Order_trackingNumber_key`
uniqueness error. Other unique conflicts, authorization failures and financial
errors are not retried as tracking collisions. Stock, guest identity, cart and
order writes share the transaction; provider calls and cookie publication are
outside the retry. Checkout diagnostics use a redacted incident reference.

## State transitions and retention

The CHECK constraints define legal values; they do not replace actor checks,
revision checks, transition guards, immutable evidence or verified webhooks.
Existing application and database services continue to enforce these rules:

- Customer registration cannot select ADMIN. Seller moderation requires a
  current verified administrator and preserves revision/audit evidence. Role
  changes revoke affected sessions under the existing account policy.
- Product creation begins pending approval. Administrator approval validates
  the current catalog and seller. Rejection/quarantine removes public visibility;
  archival retains purchase references and historical product evidence.
- Pending orders are confirmed into processing or cancelled before dispatch.
  Sellers ship only their own eligible packages. Only administrators confirm
  delivery and actual COD collection. Aggregate order status follows all
  shipment states, including PARTIALLY_SHIPPED and PARTIALLY_DELIVERED.
- Stripe payment is confirmed by verified provider evidence, not a client flag.
  COD becomes paid only when all relevant shipments have collected money.
  A cancelled order can legitimately be PAID after a late verified payment;
  refund reconciliation must handle it. The new constraints preserve this case.
- Refunds retain their separate request/reconciliation states and immutable
  amount/item evidence; payment status does not become an invented REFUNDED
  value. Dispatched shipping is excluded and stock is returned only after
  accepted physical-return inspection. COD repayment requires administrator
  confirmation plus method/reference; settlement corrections remain in ledger.
- Financial events, refunds, seller ledger/payout and commercial terms retain
  their existing append-only/guarded evidence. Migration 38 deletes no account,
  order, review, address, content revision or ledger entry. Existing foreign-key
  and trigger retention restrictions remain authoritative; this migration does
  not grant cascading deletion or bypass historical evidence guards.
- Published operator content keeps its reviewed revision pointer and private
  replacement drafts. Upgrade must not republish, withdraw or rewrite content.

See the fulfillment, refund, review, account, settlement and site-content
implementation notes for their full actor, receipt and transition contracts.

## Index review and actual plans

`scripts/rehearse-database-plans.mjs` creates its own loopback disposable database,
installs the real migration-37 baseline with Prisma CLI, inserts 20,000 products,
80 categories, 80 brands, 100 buyers and 10,000 wishlist rows, and ANALYZEs those
tables. Public catalog projection, joins, bound status filters and actual sort
shapes are explained with ANALYZE/BUFFERS/JSON before and after real CLI upgrade.
No sequential-scan disabling or forced planner settings are used. Exact ordered
result IDs are compared, and each query must actually use its reviewed index.

| Query | New index |
| --- | --- |
| Category latest | `Product_category_status_created_id_idx` |
| Brand latest | `Product_brand_status_created_id_idx` |
| Public latest | `Product_public_latest_idx` (APPROVED partial index) |
| Effective price low/high | `Product_public_effective_price_idx` (COALESCE expression, APPROVED partial index) |
| Rating/review count/latest | `Product_public_rating_idx` (APPROVED partial index) |
| Restrictive product wishlist-reference lookup | `Wishlist_productId_idx` |

The full category/brand indexes also cover their restrictive child FK lookup
prefixes. Existing seller/order/item/review/default-address indexes are retained.
A catalog metadata review found two remaining child FK prefixes without full
coverage before this change: Wishlist.productId and settlement snapshot.policyId.
Wishlist gets the measured lookup index. Snapshot policy terms are immutable;
current reads join the snapshot's captured policy to the policy primary key,
and policy deletion is already rejected by the append-only trigger. There is
no measured reverse-policy hot query to justify an extra snapshot index now.
CartLine.productId is intentionally a soft reference, allowing unavailable cart
lines to remain removable; no new destructive FK is invented for it. The
SiteContent composite primary key already covers its publication-reference
lookup; no redundant three-column index is added.

Local PostgreSQL 18 rehearsal observed category/brand catalog scans drop from
hundreds of candidate rows to indexed pages, and public scans of 17,143 approved
rows become indexed LIMIT pages. Example local times were 4.343 to 0.261 ms for
category, 106.579 to 0.207 ms for latest and 0.269 to 0.048 ms for a negative
wishlist reference lookup. These are synthetic local examples, not hosted load,
latency guarantees or production performance certification. Reproducible JSON
contains plans, work counts, buffers, version and before/after ordered IDs.

## Operator preflight and failed-upgrade recovery

Use a privately configured connection to the exact intended database. Set
`AUDIT_DATABASE_NAME` to its actual database name, not an application display
name. `npm run audit:database-invariants` requires injected `DATABASE_URL`; the
CLI deliberately does not silently load dotenv. If using a private local env
file, `node --env-file=.env scripts/audit-database-invariants.mjs` is explicit.
Do not paste secrets or preflight private connection values into issues/logs.

The command checks the actual database name and completed migration 37, opens
REPEATABLE READ READ ONLY, sets a safe search path and bounded timeouts, runs the
canonical aggregate query, then rolls back. VALID exits zero; INVALID exits one
with counts. An unavailable/mismatched target exits one with a fixed safe error.
This is an inspection command, not approval to migrate production.

If invalid counts occur, investigate privately against backed-up evidence. Role
and seller-state reconciliation requires the operator's real account records;
never guess a role. Duplicate tracking needs shipment/order evidence, including
which customer-visible code must remain. Never silently pick the first order,
delete an order or reset every code. Record the authorized reconciliation and
re-run preflight. Existing legacy formats do not need replacement merely because
new checkout codes are longer.

If Prisma deploy already failed, inspect its failed migration record and actual
DDL/data state. Only after confirming migration 38 fully rolled back and the
underlying issue is reconciled should an operator run the explicit
`npx prisma migrate resolve --rolled-back 20261105100000_database_invariants`
and retry the reviewed deploy. Do not mark a partial/uninvestigated change as
applied, edit published migration history, reset the database or automatically
resolve a failed production migration. A lost lock/time budget also requires
review before retrying.

## Reproduction and observed verification

Supply TEST_DATABASE_URL for an isolated loopback `audit_*` control database.
Runners create random owned databases; they never migrate/reset that input DB.

```sh
npm run test:database-upgrade
npm run test:database-plans
npm run test:isolated
npm run test:native
npx tsc --noEmit
npm run lint
npx prisma validate
npm run build
npm run smoke:database-invariants
npm run smoke:reliability-collections
npm run smoke:reliability-outages
npm run smoke:otp-clock
npm run smoke:refunds
npm run smoke:site-content
npm run test:browser
```

Historical local verification checkpoints (before source CI closure below):

- Real CLI baseline 37, read-only valid/invalid/wrong-target preflight, blocked
  invalid-role and duplicate-code upgrade, full DDL rollback, explicit known
  fixture-only reconciliation and Prisma resolve/retry all passed.
- Successful upgrade to 38 and second deploy preserved fingerprints/counts for
  all 62 public application tables, including nonempty account audit, shipment,
  collected COD, confirmed refund/financial events, seller ledger, captured
  commercial terms, multiple nondefault addresses and published content history.
- Actual tracking collision and three-attempt exhaustion tests prove rollback
  of guest identity, stock and order/item writes; unrelated failures do not retry.
- The historical review migration test now continues through migration 38 and
  proves the actual quarantined noncanonical duplicate survives unchanged.
- Seven actual plan queries passed with identical ordered results; local
  TypeScript, repository lint and production/standalone build passed.
- Initial complete Jest gate: 173 suites passed; one historical catalog fixture
  failed because it inserted an impossible discount now rejected by PostgreSQL.
  The corrected fixture asserts database rejection and independently retains
  unsafe-media approval validation. The next complete gate passed 174 suites /
  1,280 tests without skips, actual CLI migrations and twice-idempotent seed.
- Additional focused coverage passed all 28 invariant cases, including seven
  newly added amount/quantity compatibility cases. PostgreSQL rejects total NaN
  during the existing refund-money CHECK's bigint cast (0A000), before the new
  finite bound; the test asserts this exact error and no persistent writes.
- Final compiled readiness passed all six protection/recovery groups and final
  browsers passed 40/40 with zero retries in 6.9 minutes. Final TypeScript and
  strict repository lint passed. Source CI is pending. Initial browsers passed
  39/40; trace showed the failed
  Firefox upload's actual 503 PUT was dispatched about 14 seconds after file
  selection. The test now proves that bounded storage failure before starting
  its unchanged retry-UI assertion. A startup smoke also exposed that the Next
  banner can precede an accepting listener; it now establishes independent
  liveness before asserting the deliberately unavailable older schema.
  Both PostgreSQL 16/18 CI jobs now run upgrade/plan rehearsal
  and the compiled invariant smoke; JSON is retained with synthetic artifacts.

Compiled readiness requires migration 38, all 13 validated domain CHECK names on
their exact relations and the three exact valid/ready unique index scopes,
including retained partial predicates and NULL-distinct tracking. The probe reads
metadata, not customer records. It detects missing/NOT VALID checks and missing,
wrong-column or wrong-scope uniqueness. This does not claim cryptographic
verification of arbitrary administrator-replaced CHECK bodies or every legacy
trigger; existing UTC OTP guard and critical-column probes remain separate.
Readiness has its documented five-second cache; compiled tests observe that
bound before asserting drift and recovery without process restart.

## Main merge and external action

### Observed source CI closure

[Run 42205423702](https://github.com/asiburrahman/amar-gadget/actions/runs/42205423702)
completed successfully on b9cf24f90a2aa2ce8623499ddbc00b8014cfb6ab. Repository lint
and both database jobs passed. Downloaded logs for PostgreSQL 16 job
127850716057 and PostgreSQL 18 job 127850716398 were inspected: each contains
174 suites / 1,287 tests with no skips, 16 native tests, 40 browser cases,
actual CLI upgrade/atomic invalid-data rejection, all seven measured plans,
TypeScript/schema/build and all compiled protection/provider/content/outage
checks. Migration 38 is now published; do not edit its SQL or earlier history.

The earlier local 1,280-test full gate and later 28-case expanded invariant
suite are distinct checkpoints; the source CI ran all 1,287 tests together.
The historical failures above are retained, not relabeled as green results.

The owner explicitly authorized merging into main after implementation and
required verification. Fetch and inspect main/branch ancestry, preserve any
intervening work, merge only after source checks pass and record actual commit,
push and resulting CI. A source merge does not run production migration,
certify hosted providers, deploy services or revoke historical SMTP credentials.
AUD-051 stays open until the owner confirms provider-side revocation.
