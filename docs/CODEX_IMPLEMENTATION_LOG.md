# Codex-assisted implementation log

Owner: Asibur Rahman. Implementation assisted by OpenAI Codex, at the owner's request. Work branch: `codex/deep-audit-2026-10-28`. Main is not merged by this work.

The [original 49-task audit](DEEP_AUDIT_2026-10-28.md) remains the historical baseline. This log tracks implementation against it. A feature is complete only with the relevant code and checks; unit test mocks, local integration tests and external service tests are distinguished below.

## Batch 1 — Transaction foundation and critical boundaries

Date: 28 October 2026 (Asia/Dhaka).

| Task | Status | Change and evidence |
| --- | --- | --- |
| AUD-001 | Implemented; local integration verified | [1882b9a](https://github.com/asiburrahman/amar-gadget/commit/1882b9a): replaced runtime and seed Neon HTTP adapter with PrismaPg 7.8.0; bounded TCP connection pool; Prisma CLI prefers DIRECT_URL. Fresh isolated PostgreSQL 18 database successfully applied both checked-in migrations and ran category/brand seed. Tests exercise actual application checkout/OTP/webhook code against real PostgreSQL. |
| AUD-002 | Implemented; rendered regression verified | [027e14f](https://github.com/asiburrahman/amar-gadget/commit/027e14f): product JSON-LD escapes `<` before insertion. A malicious closing-script/name/description payload round-trips as data and renders only the intended script element. |
| AUD-003 | Implemented; SQL integration verified | [9901d86](https://github.com/asiburrahman/amar-gadget/commit/9901d86): shared public product visibility predicate now covers homepage/category/product listing/API/actions and public relation counts. BLOCKED, PENDING and REJECTED sellers disappear from queries/counts and cannot sell; existing detail route visibility checks remain enforced. |
| AUD-012 | Implemented; server-render regression verified | [4276161](https://github.com/asiburrahman/amar-gadget/commit/4276161): dashboard checks current DB-backed seller status before any catalog/customer query. Unapproved sellers get account status and profile link; admin goes to admin area. Removed fallback to another member. |
| AUD-013 | Implemented; race regression verified | [32d3142](https://github.com/asiburrahman/amar-gadget/commit/32d3142): seller shipment uses compare-and-update on PROCESSING/payment status. A concurrent cancellation/state change returns a refresh error instead of unconditionally overwriting status. |
| AUD-004–011, AUD-014–049 | Open | Remaining checkout recovery, auth, fulfillment, operating features and engineering tasks retain their original acceptance criteria. AUD-044 and AUD-049 gained partial coverage from this batch; they remain open. |

### Reproduce checks

Provision a **disposable local PostgreSQL** database named `audit_*`, apply migrations and seed with both DATABASE_URL and DIRECT_URL pointing to that database. Never use the application's real database for these integration tests. The suite rejects nonlocal hosts and database names without the `audit_` prefix, uses uniquely named fixture records and deletes its own records afterward.

```powershell
$env:DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/audit_amar_gadget'
$env:DIRECT_URL = $env:DATABASE_URL
npx prisma migrate deploy
npx prisma db seed
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm test -- --runInBand
npx tsc --noEmit
git diff --check
```

Integration suite: `tests/integration/marketplace-transactions.test.ts`. Without TEST_DATABASE_URL, the real DB suite is skipped, not counted as a live validation. Next cookie/cache/session, auth-token signing and rate-limiter boundaries are mocked; Prisma/SQL transactions and Stripe webhook signature verification are real. Stripe events are locally signed fixtures; no provider API request, live payment or email delivery occurs.

Test cases include committed server-priced COD order; rollback of guest/stock on later invalid item; competing checkout for the final stock unit; concurrent single-use OTP verification; duplicate signed payment event; duplicate expiry event with exactly-once stock restoration; and suspended-seller visibility/checkout denial. Separate regression suites cover script-safe rendered JSON-LD, blocked-seller dashboard reads and shipment state conflict.

The original `scripts/audit-offline.mjs` intentionally still demonstrates the **old HTTP adapter's limitation**. Its historical output is not a failure of the newly configured TCP adapter. No production migration was applied.

### Recorded results

**5 of the original 49 tasks implemented; 44 remain open.**

| Check | Result |
| --- | --- |
| Both checked-in migrations + seed | PASS on a fresh, isolated local PostgreSQL 18 database |
| Full Jest run with TEST_DATABASE_URL | PASS: 8 suites, 29 tests, including 7 real PostgreSQL integration tests |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS; local disposable DB URL, SKIP_ENV_VALIDATION=true |
| Targeted ESLint | PASS for adapter/config, shared policy, serializer, all new tests and updated seller dashboard page |
| Seed syntax + diff whitespace checks | PASS |

Existing lint debt in older catalog/action files remains AUD-045; this batch does not claim repository-wide lint passes. Browser walkthrough, actual SMTP/Redis/R2 integration, live Stripe checkout, deployment and Docker validation remain pending. No production database or deployment was modified.

## Public contribution evidence

Each fix commit includes the relevant AUD task ID and `Assisted-by: OpenAI Codex` trailer. Read the actual patches and tests through Git history; the repository owner retains normal authorship. This log does not imply OpenAI endorsement, Ambassador selection, funding or production readiness.

Reference for adapter setup: [Prisma PostgreSQL driver documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).
