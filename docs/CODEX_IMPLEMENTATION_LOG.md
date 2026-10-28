# Codex-assisted implementation log

Owner: Asibur Rahman. Implementation assisted by OpenAI Codex, at the owner's request. Work branch: `codex/deep-audit-2026-10-28`. Main is not merged by this work.

The [original 49-task audit](DEEP_AUDIT_2026-10-28.md) remains the historical baseline. This log tracks implementation against it. A feature is complete only with the relevant code and checks; unit test mocks, local integration tests and external service tests are distinguished below.

**Current checkpoint: 8 tasks implemented, 41 remain open.** Follow the [complete implementation sequence](IMPLEMENTATION_SCHEDULE.md). Each step keeps its original scope and validation criteria.

## Batch 1 — Transaction foundation and critical boundaries

Date: 28 October 2026 (Asia/Dhaka).

| Task | Status | Change and evidence |
| --- | --- | --- |
| AUD-001 | Implemented; local integration verified | [1882b9a](https://github.com/asiburrahman/amar-gadget/commit/1882b9a): replaced runtime and seed Neon HTTP adapter with PrismaPg 7.8.0; bounded TCP connection pool; Prisma CLI prefers DIRECT_URL. Fresh isolated PostgreSQL 18 database successfully applied both checked-in migrations and ran category/brand seed. Tests exercise actual application checkout/OTP/webhook code against real PostgreSQL. |
| AUD-002 | Implemented; rendered regression verified | [027e14f](https://github.com/asiburrahman/amar-gadget/commit/027e14f): product JSON-LD escapes `<` before insertion. A malicious closing-script/name/description payload round-trips as data and renders only the intended script element. |
| AUD-003 | Implemented; SQL integration verified | [9901d86](https://github.com/asiburrahman/amar-gadget/commit/9901d86): shared public product visibility predicate now covers homepage/category/product listing/API/actions and public relation counts. BLOCKED, PENDING and REJECTED sellers disappear from queries/counts and cannot sell; existing detail route visibility checks remain enforced. |
| AUD-012 | Implemented; server-render regression verified | [4276161](https://github.com/asiburrahman/amar-gadget/commit/4276161): dashboard checks current DB-backed seller status before any catalog/customer query. Unapproved sellers get account status and profile link; admin goes to admin area. Removed fallback to another member. |
| AUD-013 | Implemented; race regression verified | [32d3142](https://github.com/asiburrahman/amar-gadget/commit/32d3142): seller shipment uses compare-and-update on PROCESSING/payment status. A concurrent cancellation/state change returns a refresh error instead of unconditionally overwriting status. |
| Remaining tasks at end of batch 1 | Open at that checkpoint | Later progress is recorded below. AUD-044 and AUD-049 gained partial coverage from this batch; they remain open. |

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

At the end of batch 1: **5 of the original 49 tasks implemented; 44 remained open.**

| Check | Result |
| --- | --- |
| Both checked-in migrations + seed | PASS on a fresh, isolated local PostgreSQL 18 database |
| Full Jest run with TEST_DATABASE_URL | PASS: 8 suites, 29 tests, including 7 real PostgreSQL integration tests |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS; local disposable DB URL, SKIP_ENV_VALIDATION=true |
| Targeted ESLint | PASS for adapter/config, shared policy, serializer, all new tests and updated seller dashboard page |
| Seed syntax + diff whitespace checks | PASS |

Existing lint debt in older catalog/action files remains AUD-045; this batch does not claim repository-wide lint passes. Browser walkthrough, actual SMTP/Redis/R2 integration, live Stripe checkout, deployment and Docker validation remain pending. No production database or deployment was modified.

## Batch 2 — AUD-004: idempotent, abuse-limited order creation

Date: 28 October 2026 (Asia/Dhaka). One audit task implemented in this step; reservation expiry (AUD-005) and Stripe cancellation/cart recovery (AUD-006) remain separate open tasks.

Implementation commit: [67b65a1](https://github.com/asiburrahman/amar-gadget/commit/67b65a1). Planning/background commit: [6fc806b](https://github.com/asiburrahman/amar-gadget/commit/6fc806b).

The checkout form generates a cryptographically random 256-bit attempt token and retains it for the same request in session storage, with an in-memory fallback if storage is blocked. Storage contains a digest and capability, not the customer's address/contact details. Requests require the token, bounded fields, unique product IDs and bounded quantities. Missing or malformed tokens cannot create orders. An account snapshot change in the browser does not silently rotate the attempt token; the server binds the saved request to the actual authenticated identity and rejects conflicting reuse.

Order creation serializes matching token hashes with a PostgreSQL transaction-level advisory lock **before** any guest-account or inventory writes. The existing unique token-hash index remains the database uniqueness guard. A new nullable `checkoutRequestHash` column binds the request contents and server-derived identity. Replays return the original order/price; changed payloads are rejected; cancelled/failed attempts cannot revive stock or create replacement orders. A customer can explicitly start a new checkout after a closed/conflicting attempt.

Production request budgets use the existing Upstash limiter: 30 requests/minute per resolved IP and 10/minute per account or hashed guest phone. Redis is fail-closed in production; development mode retains the existing no-Redis behavior. This step tests denial handling at the limiter boundary, not a live Redis service. Trusted ingress/header enforcement remains AUD-041. The form waits for account loading, preserves customer edits during prefill, prevents simultaneous submits and no longer ships with an example address preselected. Full saved-address management remains AUD-021.

### Validation and rollout

| Check | Result |
| --- | --- |
| Fresh local PostgreSQL migration | PASS: all three migrations applied to a new `audit_*` database |
| Existing-schema upgrade | PASS: new migration applied to the earlier isolated test database; an existing order and its total remained intact with nullable request hash |
| Full Jest run with TEST_DATABASE_URL | PASS: 9 suites, 43 tests; 17 real PostgreSQL integration cases, 26 unit/regression cases |
| TypeScript, affected-file ESLint, Prisma schema validation | PASS |
| Production build | PASS with disposable local database URL and build-time environment-validation bypass |
| Diff whitespace check | PASS |

Added checks include four simultaneous retries of the final stock unit yielding one order/guest/decrement; replay after price/stock change; recovery after post-commit response-cookie failure; payload and account conflicts; retry after rollback; invalid/oversized/duplicate-item rejection; rate denial before writes; paid/expired replay; browser reload/storage failure and stale completion behavior. Only test code simulates failures/providers. Application code uses the database, cryptographic browser APIs and configured production limiter.

Migration `20261028160000_checkout_request_binding` must be applied before deploying this application revision. It is additive and preserves existing order rows. No production database, deployment or external provider was changed. Retrying after a reload requires the client to retain its attempt token; blocked storage supports in-memory retries only. Actual browser walkthrough and live Redis/Stripe checkout verification remain release work and are not represented as passed here.

Next task: **AUD-005 — persisted stock-reservation expiry and safe cleanup/reconciliation**. No other remaining task is marked complete by this batch.

## Batch 3 — AUD-005: durable reservation expiry and reconciliation

Unprovisioned unpaid Stripe orders now expire after a persisted 15-minute reservation. Provider provisioning is recorded before the network request; its fixed origin/deadline/idempotency parameters and returned session ID are durable. Known sessions are expired/queried at Stripe before inventory release; ambiguous timeouts and legacy unknown sessions retain stock with a durable review reason. Payment winning expiry is reconciled as paid. Late payment never revives an already-restocked order and is flagged for refund review. COD is excluded.

An authenticated POST endpoint and separately supervised worker perform bounded sweeps; overlapping workers, signed webhooks and administrator cancellation use a shared locked transaction. Due failures are deferred five minutes to prevent starvation. The Docker image includes the worker script. The endpoint checks its configured database name before mutation. A local HTTP smoke run of the actual built web server and worker reported `checked:1,released:1`; SQL verified the order cancelled and stock returned from 9 to 10 exactly once. Its isolated fixture records were removed afterward. See the [deployment and operator runbook](CHECKOUT_RESERVATIONS_RUNBOOK.md) for configuration, monitoring and review resolution. The production worker has not been deployed by this change.

Validation: all four migrations passed on a fresh local PostgreSQL database; the previous-schema upgrade preserved an existing Stripe order and marked it as legacy/unknown instead of releasing it. **52 tests across 9 suites pass**, including 26 real PostgreSQL integration cases. Additional coverage proves abandoned release, overlapping cleanup, uncertain provider response, stable retry parameters, provider-expiry/payment races, authenticated sweeps, unavailable provider backoff and worker/webhook exactly-once restock. Stripe network responses are fixtures only in tests; the SDK signature check and SQL are real. TypeScript, affected-file lint, worker syntax, diff checks and production build pass. No live Stripe payment or production migration was performed.

Next independent task: **AUD-006 — retain cart/context and resume the same checkout through Stripe cancellation, failures and completion**.

## Batch 4 — AUD-006: payment cancellation, retry and cart recovery

Checkout now retains its cart and records purchased line/quantity snapshots when an order is created. The dedicated `/checkout?resume=<orderId>` screen loads the saved items, shipping address and authoritative total through a private capability/owner-authorized API. A scoped HttpOnly cookie carries guest access; no capability is put in the URL. Authenticated users cannot use another account's leftover capability. Payment retries reuse the saved order/session; failures leave the cart intact. Cancellation first closes the provider session safely, then allows a new checkout.

The confirmation screen polls server payment state for a bounded period and offers explicit refresh. Client query-string payment claims are ignored. Purchased quantities are removed only after verified payment (or accepted COD creation), once per saved snapshot. Additional quantities, unrelated items, and lines removed/re-added during payment are preserved. Pending context survives reload; a new visit to checkout resumes outstanding context instead of silently starting another order. A late paid/cancelled order keeps its cart and shows refund-review information.

Migration `20261028180000_checkout_resume_version` preserves the exact cancel URL parameters for sessions requested before this revision; newly prepared sessions use the resume URL. The previously broken cart hydration helper is corrected as an adjacent requirement; AUD-045's remaining repository lint work is still open.

Validation: **62 tests across 10 suites**, including real PostgreSQL ownership/session/cancellation cases and DOM interaction/storage-reload tests, plus TypeScript, affected-file lint and production build. Provider network responses are controlled fixtures only in tests, never application fallbacks. Five migrations are now required for a fresh installation. Live hosted Stripe/real-device walkthrough and production rollout remain external verification; no production database or provider payment was modified.

Next independent task: **AUD-007 — authoritative coupon validation and shared server quote calculation**.

## Public contribution evidence

Each fix commit includes the relevant AUD task ID and `Assisted-by: OpenAI Codex` trailer. Read the actual patches and tests through Git history; the repository owner retains normal authorship. This log does not imply OpenAI endorsement, Ambassador selection, funding or production readiness.

Reference for adapter setup: [Prisma PostgreSQL driver documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).
