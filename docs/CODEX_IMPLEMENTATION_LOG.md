# Codex-assisted implementation log

Owner: Asibur Rahman. Implementation assisted by OpenAI Codex, at the owner's request. Work branch: `codex/deep-audit-2026-10-28`. Main is not merged by this work.

The [original 49-task audit](DEEP_AUDIT_2026-10-28.md) remains the historical baseline. This log tracks implementation against it. A feature is complete only with the relevant code and checks; unit test mocks, local integration tests and external service tests are distinguished below.

**Current checkpoint: 18 original tasks plus AUD-050 implemented (19 of 51 tracked tasks); 31 original tasks and external credential revocation for AUD-051 remain open (32 open total).** Follow the [complete implementation sequence](IMPLEMENTATION_SCHEDULE.md). Each step keeps its original scope and validation criteria. The standing objective is to finish all remaining tasks, one focused commit/push per task; this checkpoint is not completion of that objective.

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

Implementation commit: [88532cd](https://github.com/asiburrahman/amar-gadget/commit/88532cd).

Unprovisioned unpaid Stripe orders now expire after a persisted 15-minute reservation. Provider provisioning is recorded before the network request; its fixed origin/deadline/idempotency parameters and returned session ID are durable. Known sessions are expired/queried at Stripe before inventory release; ambiguous timeouts and legacy unknown sessions retain stock with a durable review reason. Payment winning expiry is reconciled as paid. Late payment never revives an already-restocked order and is flagged for refund review. COD is excluded.

An authenticated POST endpoint and separately supervised worker perform bounded sweeps; overlapping workers, signed webhooks and administrator cancellation use a shared locked transaction. Due failures are deferred five minutes to prevent starvation. The Docker image includes the worker script. The endpoint checks its configured database name before mutation. A local HTTP smoke run of the actual built web server and worker reported `checked:1,released:1`; SQL verified the order cancelled and stock returned from 9 to 10 exactly once. Its isolated fixture records were removed afterward. See the [deployment and operator runbook](CHECKOUT_RESERVATIONS_RUNBOOK.md) for configuration, monitoring and review resolution. The production worker has not been deployed by this change.

Validation: all four migrations passed on a fresh local PostgreSQL database; the previous-schema upgrade preserved an existing Stripe order and marked it as legacy/unknown instead of releasing it. **52 tests across 9 suites pass**, including 26 real PostgreSQL integration cases. Additional coverage proves abandoned release, overlapping cleanup, uncertain provider response, stable retry parameters, provider-expiry/payment races, authenticated sweeps, unavailable provider backoff and worker/webhook exactly-once restock. Stripe network responses are fixtures only in tests; the SDK signature check and SQL are real. TypeScript, affected-file lint, worker syntax, diff checks and production build pass. No live Stripe payment or production migration was performed.

Next independent task: **AUD-006 — retain cart/context and resume the same checkout through Stripe cancellation, failures and completion**.

## Batch 4 — AUD-006: payment cancellation, retry and cart recovery

Implementation commit: [ed3f164](https://github.com/asiburrahman/amar-gadget/commit/ed3f164).

Checkout now retains its cart and records purchased line/quantity snapshots when an order is created. The dedicated `/checkout?resume=<orderId>` screen loads the saved items, shipping address and authoritative total through a private capability/owner-authorized API. A scoped HttpOnly cookie carries guest access; no capability is put in the URL. Authenticated users cannot use another account's leftover capability. Payment retries reuse the saved order/session; failures leave the cart intact. Cancellation first closes the provider session safely, then allows a new checkout.

The confirmation screen polls server payment state for a bounded period and offers explicit refresh. Client query-string payment claims are ignored. Purchased quantities are removed only after verified payment (or accepted COD creation), once per saved snapshot. Additional quantities, unrelated items, and lines removed/re-added during payment are preserved. Pending context survives reload; a new visit to checkout resumes outstanding context instead of silently starting another order. A late paid/cancelled order keeps its cart and shows refund-review information.

Migration `20261028180000_checkout_resume_version` preserves the exact cancel URL parameters for sessions requested before this revision; newly prepared sessions use the resume URL. The previously broken cart hydration helper is corrected as an adjacent requirement; AUD-045's remaining repository lint work is still open.

Validation: **62 tests across 10 suites**, including real PostgreSQL ownership/session/cancellation cases and DOM interaction/storage-reload tests, plus TypeScript, affected-file lint and production build. Provider network responses are controlled fixtures only in tests, never application fallbacks. Five migrations are now required for a fresh installation. Live hosted Stripe/real-device walkthrough and production rollout remain external verification; no production database or provider payment was modified.

Next independent task: **AUD-007 — authoritative coupon validation and shared server quote calculation**.

## Batch 5 — AUD-007: authoritative coupon validation and checkout quotes

Cart and checkout now request the same server-calculated quote used inside the order transaction. The endpoint validates bounded cart quantities, current approved product/seller availability, stock, prices and actual database coupons. Arbitrary configured codes work; hardcoded promotional success and persisted client discount arithmetic are removed. Fixed and percentage discounts, expiry, minimum spend, two-decimal half-up rounding and shipping use one calculation. Fixed discounts cannot exceed the merchandise subtotal; totals exceeding the order column's supported range are rejected.

Both screens display returned line prices, discount, shipping and total. A failed quote blocks new checkout and provides retry/coupon removal. An old quantity response cannot replace a newer cart quote; coupon validation for changed items is discarded. The checkout form submits the displayed quote fingerprint. If price or coupon terms change, the transaction rejects the stale quote before guest/inventory writes, refreshes the summary and requires another explicit submission. The fingerprint is an optional compatibility precondition for existing direct action consumers; every request still derives all prices and discounts on the server. It is excluded from checkout identity so replay of an already committed attempt always returns its saved order, even after prices change.

Validation: **80 tests across 11 suites**, including 12 added real PostgreSQL quote/coupon cases and 6 DOM interaction cases. Coverage includes arbitrary database codes, fixed/percentage amounts, expired/inactive/invalid coupons, minimum-spend equality/failure, capped discounts, fractional rounding, shipping threshold, changed-price/discount review, saved-order replay, stale browser responses and quote-service failures. TypeScript, affected-file ESLint, Prisma validation, diff checks and production build pass. No additional migration is required for this task. The build used the disposable local database and environment-validation bypass; hosted Stripe, actual browser/device and production rollout checks remain pending. Only test code substitutes provider/service responses.

This concludes the requested three-task sequence (AUD-005, AUD-006, AUD-007), with one focused implementation commit per task. The next scheduled task is **AUD-025 — complete order-success payment/status presentation and guest tracking navigation**, followed by **AUD-026 — persist order transition history**. Partial order-success improvements in AUD-006 do not mark AUD-025 complete.

## Batch 6 — AUD-025: complete order-confirmation payment states

Implementation commit: [c0c55c0](https://github.com/asiburrahman/amar-gadget/commit/c0c55c0).

The whole confirmation summary now reads one current authorized order state: heading, payment/delivery labels, totals and recovery navigation update together. COD shows amount due on delivery; pending Stripe explicitly awaits server confirmation; failed/cancelled orders do not show a success claim. Late payment on a cancelled order is labelled as received for refund review. Paid completion removes only the saved purchased quantities through the existing idempotent cart contract.

The confirmation's scoped, private `GET /order-success/<id>/status` uses the original HttpOnly guest cookie path or the authenticated owner/admin. It returns no capability/hash/user ID, ignores client payment claims, rate-limits requests and returns controlled unavailable/access-expired errors. A signed-in different account cannot use a leftover guest cookie. Twelve five-second polls stop on terminal payment/cancellation, errors or the time limit; explicit refresh remains available. Older responses cannot overwrite a newer result. Guest navigation goes to working phone-verified tracking with instructions; only the actual owner sees account order history. Initial database outages are distinguished from missing/expired access.

Validation: **89 tests in 12 suites**, including eight new DOM cases for delayed confirmation, COD, failure/cancellation, late payment, bounded polling, service failure and stale-response ordering, plus real PostgreSQL confirmation endpoint authorization/state/cache/rate-limit coverage. TypeScript, affected-file ESLint, diff checks and production build pass with the disposable local database and build-time environment-validation bypass. The delayed-payment walkthrough uses controlled HTTP responses in DOM tests; hosted Stripe and actual browser/device verification remain release checks under AUD-044. No migration, production database change or deployment is part of this task.

Next task: **AUD-026 — durable transition history and actual shipment tracking fields**. All remaining audit tasks remain in scope.

## Batch 7 — AUD-026: durable order history and shipment tracking

Implementation commit: [fa8f88b](https://github.com/asiburrahman/amar-gadget/commit/fa8f88b).

Migration `20261028190000_order_event_history` adds an indexed, ordered `OrderEvent` history and separate carrier/parcel fields. A database trigger records creation and real status/payment/shipment changes atomically for every application path, including webhook/worker SQL writes. No-op/duplicate updates produce no event; rolled-back writes leave no event. A monotonic database sequence orders changes even within the same millisecond. Events cannot be edited or individually deleted while the parent order exists. Parent deletion retains the existing cascade policy; financial/deletion retention constraints remain AUD-049.

Existing orders receive their known creation time and an explicitly undated current-state snapshot. Earlier shipment/cancellation times are never invented from `createdAt` or `updatedAt`. Tracking now shows actual recorded events and unknown legacy times, current carrier/parcel data, and complete history through 50-event cursor pages. Cursor ownership, bounded inputs, the existing phone check and private/no-store responses protect lookups. Navigation from admin and confirmation pre-fills the order/tracking code; the customer must still provide the checkout phone number. Updates occur only on explicit lookup/refresh/pagination; the page no longer advertises real-time push tracking.

The admin orders page includes a real carrier/tracking editor backed by a validated administrator-only conditional mutation. Only processing/shipped orders with eligible payment can be edited; concurrent cancellation prevents the write. Save failures are visible, duplicate saves do not manufacture events, and saved values survive a local transition to read-only state. Seller-specific shipments for mixed-vendor baskets remain the separate AUD-014 task.

Validation: **96 tests across 13 suites**, including SQL history immutability/rollback, seller→admin transitions, duplicate signed payment/expiry events, unauthorized/invalid/unpaid shipment writes, full 56-event pagination and foreign-cursor denial. Four added DOM cases cover real field submission, failure feedback, unknown legacy dates and history pagination. All six migrations pass on a fresh disposable PostgreSQL database. A separate five-migration upgrade rehearsal preserved a pre-existing shipped COD order's total/state, retained its exact creation time and left the legacy shipment time null. TypeScript, affected-file ESLint, Prisma validation, diff checks and production build pass. No production migration/deployment or real carrier/provider operation was performed. Actual browser/provider verification remains AUD-044.

See [order history operations](ORDER_HISTORY_RUNBOOK.md) for rollout and retention behavior. Next: **AUD-008 — versioned strong password storage and compatible login-time migration**. The full remaining-task goal stays active.

## Batch 8 — AUD-008: versioned password hashes and compatible migration

Implementation commit: [5600f50](https://github.com/asiburrahman/amar-gadget/commit/5600f50).

All active password writers use asynchronous, random-salted scrypt with explicit version/allowlisted cost parameters and timing-safe digest comparison. The supported legacy PBKDF2 format retains its exact hexadecimal-salt-as-text and password-byte contract. Successful legacy login upgrades through a compare-and-update; concurrent login can reuse a completed upgrade, while a winning password reset cannot be overwritten or authenticated with the old password. New registration, password reset/change and operator account creation await the same implementation. No database migration or mass reset is needed.

The KDF uses the [OWASP-listed 64 MiB scrypt profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt) with Node's asynchronous crypto API, two active jobs, 16 queued jobs, a five-second queue timeout and controlled HTTP 503/Retry-After on saturation. Nonexistent/malformed credentials and failed legacy comparisons still spend the current KDF cost. No password normalization/truncation is introduced. Legacy/malformed format parsing cannot select arbitrary resource costs.

The old hash/password-printing diagnostic is replaced by a bounded read-only format inventory. The fixed-credential JavaScript seeder and personal-account reset script are retired in favor of explicit environment-configured account seeding/provisioning with shared hashing and no plaintext/hash output. Actual CLI integration tests run only against the disposable local database. `tsx` is a development/operator tool dependency, not a new application runtime requirement. Old ad hoc OTP/token-printing diagnostics remain recorded follow-ups for AUD-009/010; they are not safe production verification tools.

Validation: **111 tests across 15 suites**, including real PostgreSQL legacy upgrade, concurrent-login/reset conflict, registration/reset/change, overload response and actual seed/provision/inventory CLI cases, plus native-crypto format/salt/Unicode/long-password/timing-safe/queue tests. TypeScript, affected-file ESLint, diff checks and production build pass with the isolated local database and environment-validation bypass. The reproducible local benchmark (`npm run bench:passwords`, Node 24.19.0 on Windows, five sequential samples) measured mean hash **392.0 ms**, mean verification **380.3 ms**, four queued/concurrent hashes **916.4 ms**, sampled process peak RSS **197.6 MiB** and maximum observed event-loop delay **15.5 ms**. These are local measurements, not deployment performance guarantees. See [password storage operations](PASSWORD_STORAGE_RUNBOOK.md).

The dependency check also exposed existing vulnerable packages: full `npm audit` reports 27 affected entries; `npm audit --omit=dev` reports 17 (1 critical, 10 high, 6 moderate). This is not represented as a clean dependency scan or a fixed release. [AUD-050](ADDITIONAL_AUDIT_FINDINGS.md) records the separate urgent remediation task, prioritized next. Session revocation, OTP-purpose isolation and consistent account input policy remain AUD-010/009/011 respectively. No production accounts, credentials, provider or deployment were changed.

## Batch 9 — AUD-050: framework/dependency security and reviewed vendor mitigation

Implementation commit: [c3d3fe2](https://github.com/asiburrahman/amar-gadget/commit/c3d3fe2).

Next/eslint-config-next are aligned at 16.4.3, React/React DOM at 19.2.9, the Prisma 7 client/CLI/config/adapters at 7.10.1, Zod at 4.6.7 and Nodemailer at 10.2.1. Compatible Jest/ts-jest and targeted transitive updates resolve the audited high/moderate dependency graph without a forced major/downgrade. The package declares Prisma-compatible Node requirements, and the README records current versions. The updated installed Next migration/route/action/standalone guides were read. Jest ignores generated standalone output to avoid a duplicate-package crawl. Docker dependency installation now honors the lockfile without a fallback install and explicitly applies the reviewed patch in its builder.

**Production dependency audit: 0 vulnerabilities. Full registry audit: 6 low-severity entries**, from deepmerge and its development-only Jest/ts-jest ancestry. No upstream fixed release exists at review time. A small committed `patch-package` mitigation preserves literal data keys with own data-property definitions, preventing returned-object prototype poisoning in all three merge write sites. It applies to CJS/UMD/source, is reproduced by clean install with failure checking, and retains the real package version. Five regressions reproduce the original vulnerable behavior in an isolated reference and prove installed mitigated behavior, normal descriptors, nested values and all write branches. The full registry scan remains nonzero and is reported transparently; no arbitrary advisory suppression or fake version was added. Neither deepmerge nor Jest appears in the inspected standalone production dependency directory. See [additional findings](ADDITIONAL_AUDIT_FINDINGS.md), [machine-readable audit snapshot](dependency-security-2026-10-28.json) and [patch rationale](../patches/README.md).

Validation: clean `npm ci` including automatic patch/client generation; **116 tests across 16 suites**; TypeScript, affected-file lint, schema validation, fresh six-migration install plus seed and preserved legacy upgrade fixture; production build; and real local standalone HTTP queries proving catalog SQL, product server rendering and unauthenticated admin redirection. The initial generic HTTP smoke failed once; improved safe phase diagnostics and five successful follow-up runs, including after a new build, did not reproduce an application fault. This is recorded rather than omitted. The runner is reproducible with `TEST_DATABASE_URL` pointing only at a local `audit_*` database and `npm run smoke:standalone`; it removes its own fixtures/process. No hosted browser/provider or container validation is inferred. Docker is not installed here. Builds use the disposable database and build-time environment-validation bypass; no production database or deployment was changed.

The original full remaining-task objective stays active. Next: **AUD-009 — purpose/user-bound, hashed, single-use OTP and atomic email-change verification**. AUD-044 retains browser/CI/release verification and upstream patch follow-up scope.

## Security interruption — AUD-051: remove exposed SMTP fallback

Tracked hardcoded SMTP authentication fallback was discovered while tracing OTP delivery for AUD-009. It is removed in favor of explicitly configured credentials and sender; transport is created only when needed, requires TLS/STARTTLS appropriately and has bounded timeouts. Missing configuration fails before OTP writes. Mail failure returns/logs a controlled message without raw provider details or credential/code output. The original credential is not repeated in documentation or used for a provider request.

Nine focused transport/configuration regressions cover missing settings/sender, valid TLS configuration, invalid ports, actual configured sender selection, delivery failure cleanup and redacted errors. Full local validation: **125 tests across 17 suites**, TypeScript and affected-file ESLint pass. No new standalone build, live SMTP or account action is represented as passed for this isolated hotfix. **This task remains open for the account owner's revocation/rotation confirmation**, since current-source removal does not revoke a historically exposed credential. See [AUD-051](ADDITIONAL_AUDIT_FINDINGS.md). Independent AUD-009 implementation continues while that external action is pending.

## Batch 10 — AUD-009: purpose-bound OTP and atomic email change

Implementation commit: [0f0c255](https://github.com/asiburrahman/amar-gadget/commit/0f0c255).

Each random six-digit code is bound to an account, purpose, target email, issuance and account-state fingerprint, with only a keyed HMAC stored. A dedicated private `OTP_SECRET` is mandatory. Database-clock expiry, persistent account/purpose attempt and send budgets, delivery gating and locked single-use consumption protect every OTP route. Failed/superseded delivery cannot remove a newer token. Expensive password work occurs outside the account lock; consumption and the actual account update commit or roll back together. All other outstanding codes for the account are invalidated after a successful mutation.

Signup requires its registration password as well as its own code, preventing pending-registration password substitution from activating an attacker's password. Reset codes cannot establish signup sessions, and reset returns no login cookie. Email change requires current-password reauthentication and same-account ownership. Uniqueness conflicts and signing failures preserve the account and code. The UI requires full six-digit codes (including leading zeros), respects cooldowns, prevents overlapping requests and updates account state only from server success. The old plaintext-code-reading registration diagnostic is removed. The formerly ignored, empty-value `.env.example` is now tracked explicitly and includes the private OTP key setting; no credentials are committed.

Validation: **152 tests in 19 suites pass**, including 20 added real PostgreSQL OTP cases and seven DOM cases. TypeScript, all affected-file ESLint, Prisma validation and diff checks pass. Production build passes using the isolated local database and build-time environment-validation bypass. Actual standalone HTTP smoke passes for health, catalog SQL, product server rendering and unauthenticated admin redirect. Fresh seven-migration installation and a separate six-to-seven existing-data rehearsal pass: complete account, order and ordered history records remain equal while old unbound codes are invalidated and the new constraints are installed. The latest full repository lint still has 76 errors and 67 warnings; AUD-045 remains open.

See [OTP rollout and operations](OTP_SECURITY_RUNBOOK.md) for coordinated schema/application deployment, key configuration, limits and failure behavior. No production migration, live SMTP/Redis/Stripe operation or actual browser walkthrough is claimed. AUD-051 still awaits owner revocation confirmation. Next: **AUD-010 — revoke prior sessions after password reset/change and centralize current-session validation**. The full remaining-task objective continues.

## Batch 11 — AUD-010: database-backed session revocation

Implementation commit: [218d10a](https://github.com/asiburrahman/amar-gadget/commit/218d10a).

New JWTs carry a required nonnegative account session version; central validation checks the current verified account/version/email/role on every protected entry point. The database trigger increments the version for password hash, email, role, verification and seller-status changes, covering operator/provisioning paths too. It rejects version rollback and preserves sessions on ordinary profile edits. Password change compares the original credential/version, revokes all sessions, expires the current cookie and redirects the UI to sign in. Reset requires a fresh login; email verification/change return the planned post-mutation cookie. Legacy password upgrades reload their resulting version and cannot overwrite a winning reset. Login rejects credential changes while password work was in flight.

The previously signature-only me/profile/avatar/password routes now use current database authority. The navigation proxy remains optimistic; layouts/actions/APIs enforce revocation. Its fallback secret and sensitive error logging are removed, and cryptographic helpers are separated from password code. Legacy JWTs without a version intentionally require sign-in after coordinated deployment. Unsafe first-user token-printing and fixed-credential HTTP scripts are removed. Profile/avatar errors touched by this boundary change no longer return raw exceptions; complete input/media policies remain separate tasks.

Validation: **167 tests across 20 suites pass**, including 13 integration cases with actual jose signing/verification, native password hashing, PostgreSQL triggers and application routes, plus two password-change UI regressions. Jest transforms jose's ESM implementation instead of mocking cryptography. Cases cover copied cookies after reset/change, fresh login, formerly signature-only endpoints, versionless/forged/expired/wrong-algorithm tokens, deletion, all security-state changes, ordinary edits, signup/email replacement cookies, login/reset races, concurrent password changes and rollback. TypeScript, affected-file lint, schema validation and production build pass. Fresh eight-migration install/seed and seven-to-eight upgrade preserve complete existing account/order/history records and add version zero.

Built standalone HTTP verification proves an actual signed profile read, then 401/profile and unauthenticated/me after revocation, plus dashboard login redirect. An initial health probe failed without a classified cause; the next run reached the dashboard check, where a 200 streaming redirect was incorrectly treated as access. The assertion was corrected against the installed Next redirect guide to require its actual login meta redirect (or an HTTP redirect); the complete follow-up smoke passed. No application authorization bypass was found in that streaming response. Safe phase/network diagnostics were retained. This does not establish general cold-start reliability or actual browser/provider readiness.

See [session policy and rollout](SESSION_SECURITY_RUNBOOK.md). No production migration/deployment, live provider operation or real browser walkthrough occurred. Next: **AUD-011 — consistent account validation and account/IP request budgets**. All remaining tasks stay in scope.

### Follow-up: bounded cold-start measurement (AUD-042 release evidence)

The final rebuild after the password-change race-response correction passed, but its first health smoke timed out again at the old ten-second request deadline while the child server remained running. This reproduces a cold-start/probe issue; the prior successful runs do not establish reliable ten-second readiness. The immediately preceding built-server smoke had twice passed the full signed-cookie revocation and dashboard checks. No protected-access regression is inferred from a health timeout, and the timeout is not counted as a successful smoke.

The runner now separates a bounded thirty-second initial health budget from the unchanged ten-second subsequent-request budgets and reports actual first-health milliseconds. A new build passed, followed immediately by a complete smoke pass: **first health response 14,171 ms, initial limit 30,000 ms**; all catalog/server-render/signed-cookie/API-revocation/dashboard checks passed within their subsequent-request limits. This directly explains why a ten-second probe was insufficient on this run, without establishing the underlying latency cause. The measurement is diagnostic instrumentation, not a production readiness/performance fix; startup behavior and actual deployment readiness remain open under AUD-042/044.

## Batch 12 — AUD-011: consistent account validation and request budgets

Implementation commit: [149b735](https://github.com/asiburrahman/amar-gadget/commit/149b735).

Registration, reset, change and operator-created new passwords share the established registration strength policy with an explicit 8–128-character bound. Login/current-password proof preserve existing password bytes and remain compatible with older credentials. Shared bounded schemas cover names, email, confirmation, profile, required address fields and image references; profile privilege fields, unsafe/malformed URLs and database-incompatible null characters are rejected before writes. Registration/reset/profile forms use the same policy, and normalized profile values come from the server response.

A bounded streaming JSON reader rejects malformed/invalid UTF-8 bodies with 400 and declared/actual oversized bodies with 413. Sensitive mutations enforce separate IP and account/email budgets through the configured distributed limiter before password work or writes. Identity keys are digested and operation-scoped, with conservative Retry-After responses; a new source IP does not reset the target email's account budget. Public reset/resend responses consistently acknowledge a request for absent/deliverable/undeliverable accounts without asserting delivery. Internal/provider/SQL errors are not returned or logged raw by the changed account handlers/limiter. This is not a timing-indistinguishability claim; synchronous provider timing remains an explicit boundary in the runbook.

Validation: **188 tests across 22 suites pass**, including 20 new schema/streamed-body/SQL endpoint cases and a password-reset DOM regression. TypeScript, all affected-file lint, diff checks and final production build pass. Immediate standalone HTTP smoke passes, including actual signed profile reads, SQL catalog, revoked-cookie API denial and dashboard login redirect; first health response **6,215 ms** within the distinct thirty-second startup budget. No new migration is needed. The current repository-wide lint remains open: **68 errors, 60 warnings**. Tests control the limiter/SMTP boundary; no real provider delivery, Redis request, production deployment or browser walkthrough is claimed.

See [account input and rate policy](ACCOUNT_INPUT_RUNBOOK.md) for exact budgets, compatibility and limitations. Bounded legacy raster-data avatars remain pending AUD-038's storage/signature/lifecycle work. Profile/address atomic consistency remains the next separate task, **AUD-039**; runtime/proxy boundaries follow as AUD-040/041. Every remaining task stays in scope.

## Batch 13 — AUD-039: atomic profile and default-address saves

Implementation commit: [d444449](https://github.com/asiburrahman/amar-gadget/commit/d444449).

Profile/default-address writes now execute in one PostgreSQL transaction under the account lock, rechecking current verification/session authority before any mutation. Failure after a profile write rolls it back with the address operation. Simultaneous first saves serialize and update one coherent default rather than creating duplicates or mixing profile/address snapshots. A partial unique index enforces at most one default per account even for direct SQL; zero defaults and multiple nondefault addresses remain valid. Server-derived ownership and strict input schemas reject client address-ID/owner injection.

Migration `20261028220000_atomic_profile_default` preserves every legacy address row/content/timestamp, retaining the most recently updated default per account with deterministic creation/ID ties and demoting duplicate flags. Fresh nine-migration install/seed and an eight-to-nine upgrade with deliberately ambiguous defaults pass. Exact pre/post account/order/history/address comparisons confirm preservation and the intended deterministic flags. See [profile/default-address rollout](PROFILE_ADDRESS_RUNBOOK.md) for review and coordinated deployment; no production migration occurred.

The editor reads only an actual default, uses normalized committed values, retains edits on failure and disables overlapping saves/edits. Missing defaults do not preselect a district; district text completion permits actual locations outside the suggestion list. Full saved-address CRUD/checkout selection remains AUD-021.

Validation: **197 tests across 23 suites pass**, including seven new real SQL cases and two DOM success/failure cases. The rollback case uses a real test-only SQL constraint rather than a simulated database result; direct concurrent SQL also proves the unique index. TypeScript, affected-file lint, Prisma schema validation, whitespace checks and final production build pass. Immediate standalone HTTP/SQL/signed-cookie smoke passes, with first health **6,357 ms** under the separate thirty-second startup budget. No actual browser/provider/deployment verification is inferred.

On 29 October 2026 (Asia/Dhaka), the owner confirmed the SMTP credential has not yet been revoked. [AUD-051](ADDITIONAL_AUDIT_FINDINGS.md) remains open for that actual external action; no secret was requested or shared. Next original task: **AUD-040 — unify runtime configuration, fail-fast service requirements and readiness/liveness**. The full remaining-task objective stays active.

## Batch 14 — AUD-040: runtime contract, preflight and readiness

Date: 29 October 2026 (Asia/Dhaka).

One shared schema now supplies startup and the actual database/JWT/OTP/SMTP/Redis/Stripe/R2/sweep helpers. JWT/OTP/sweep key byte rules are consistent and private keys must be distinct. Production requires complete service groups, a matching worker database and an explicit server `APP_URL`; checkout origins no longer derive from untrusted request hosts or a public build variable. Unused NextAuth/OAuth/publishable-key requirements, database-variable fallbacks and runtime skip behavior are removed. Redis requests have a fresh two-second signal and no automatic retry.

The supported production launcher validates compiled configuration before opening a listener and exits nonzero on missing/invalid fields. `npm start` can explicitly load a private workspace env file; the Docker/prepared artifact starts through `start.cjs` with injected environment. A real generated standalone dotenv file was observed without reading or publishing its content; the build now strips dotenv files, excludes private Docker inputs and packages public/static assets. Original private workspace files are not modified. Framework instrumentation also validates runtime startup. Installed Next source confirmed its banner is emitted before config loading and eager prepare can log failures without closing the listener; the explicit preflight avoids relying on that banner. This also clarifies earlier first-probe latency measurements without claiming a general performance fix.

`/api/health` is liveness only. `/api/health/ready` reports configured DB/migration/Redis readiness with 200 or 503 and safe booleans, no-cache headers, bounded connection/query/Redis waits, per-worker singleflight and a five-second result cache. It does not perform vendor mail/payment/storage operations. A required-migration constant is checked against the checked-in migration history.

Validation: **228 tests across 26 suites pass**, TypeScript and all affected-file lint/whitespace checks pass; final production build succeeds and removes its copied build env file. Actual prepared-server smoke proves missing JWT/Redis/origin/storage settings exit nonzero before the banner despite the old skip flag, no dotenv artifact, and database outage readiness 503/liveness 200. The full HTTP smoke proves real password/login/JWT/SQL, shipped CSS/public assets, healthy readiness and Redis outage 503/liveness 200 using the actual Upstash SDK against a local test-only REST boundary, plus copied-cookie revocation and dashboard redirect. Final first-health response: **717 ms**, excluding launcher preflight; no comparison/performance guarantee is inferred. Production dependency audit still reports **0 vulnerabilities**. No new migration is needed.

Startup diagnostics initially treated Next's early banner as successful initialization; inspecting the installed source corrected that test assumption and motivated the pre-listen launcher. A test REST fixture initially omitted the SDK's base64 response encoding; it was corrected rather than weakening the real PING readiness check. Final smokes exercise the actual prepared entry point and protocol behavior. No production deployment, provider operation, actual browser walkthrough or container image build is claimed. Hosted SMTP/Stripe/R2/Upstash verification and full CI/release work remain open. AUD-051 still requires the owner's credential revocation.

See [runtime configuration and startup](RUNTIME_CONFIGURATION_RUNBOOK.md). Next original task: **AUD-041 — trusted proxy/header ingress and exact production action origins**. The complete remaining-task objective stays active.

## Batch 15 — AUD-041: authenticated ingress and exact browser origins

Date: 29 October 2026 (Asia/Dhaka). Previous runtime step: [`de038cb`](https://github.com/asiburrahman/amar-gadget/commit/de038cb).

Production no longer derives limiter identities from arbitrary Cloudflare, forwarded or Vercel headers. A dependency-free loopback gateway removes caller trust/middleware/hop headers, signs a canonical socket or explicitly configured local-tunnel visitor IP, and binds the assertion to origin, method, path/query, timestamp and nonce. Next verifies the actual request scope before application routes/actions run. The assertion expires after 120 seconds; production requires a separate private key, while unsigned development uses one fixed identity. Existing independent hashed-account budgets remain in force. Public GET/HEAD health/static/physical assets remain available without ingress; actions and writes cannot use those paths as exemptions.

The gateway checks canonical Host, supplies canonical upstream host/protocol, filters private assertion headers from responses, streams HTTP under body/time bounds and rejects unavailable backends. Cloudflare mode trusts only its primary connecting-IP header over the private local tunnel hop. Pseudo IPv4 overwrite is rejected; Off/Add Header preserves the real primary identity, and auxiliary IPv6 headers cannot rotate it. Local host processes are explicitly inside this trust boundary. Public forwarding to the gateway is unsupported; app/gateway ports must stay private. These are deployment prerequisites, not a claim that the remote firewall/tunnel has already been configured.

Wildcard tunnel/dev/action origins are removed. Every production browser mutation, including server actions, requires the exact configured scheme/host/port Origin. Missing-Origin exemptions are limited to the authenticated Stripe webhook and sweep endpoint, excluding actions. Next's own same-origin action check remains enabled. The supervised worker now signs its real scoped POST in addition to Bearer authentication. Preparation packages all native gateway/worker modules; README/Docker examples publish only the backend's loopback port. Named tunnel commands replace unsafe arbitrary quick-tunnel entry points. See the [ingress configuration, process and verification runbook](TRUSTED_INGRESS_RUNBOOK.md).

Validation: **248 Jest tests across 27 suites and four native HTTP/gateway/worker tests pass**. TypeScript, affected-file ESLint, diff checks and production build pass. The actual prepared standalone smoke passes catalog SQL, product server rendering, assets, configured login/readiness, Redis-outage/liveness distinction and cookie revocation. Runtime smoke additionally proves missing ingress key exits before listening, with the old bypass flag ineffective. The new real gateway/built-app HTTP smoke proves unsigned direct-origin/header spoof rejection, expired/tampered/wrong-method/wrong-query rejection, catalog, canonical redirects, browser-origin enforcement, action attempts on public asset paths, independent Stripe-signature rejection and a 429 on the eleventh login despite eleven different spoofed forwarding IPs.

The initial synthetic RSC request received Next's expected 307 because it omitted/mismatched the installed client's cache-busting header hash. The runner now computes that real client hash rather than disabling the framework check, and actual RSC content/prefetch passes through the gateway. Native tests also cover declared/chunked oversized inputs, stripped response hop/private headers, IPv6 canonicalization, unsupported pseudo-IP mode and the real supervised worker's two authentication layers. No production migration, deployment, Docker execution, live Cloudflare tunnel or hosted provider operation was performed; those release checks remain AUD-044. AUD-051 remains open because the owner confirmed the exposed SMTP credential is still not revoked.

Next original task: **AUD-016 — complete Cloudflare R2 product-image upload wiring and storage policy**. The entire remaining-task objective stays active.

## Public contribution evidence

Each fix commit includes the relevant AUD task ID and `Assisted-by: OpenAI Codex` trailer. Read the actual patches and tests through Git history; the repository owner retains normal authorship. This log does not imply OpenAI endorsement, Ambassador selection, funding or production readiness.

Reference for adapter setup: [Prisma PostgreSQL driver documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).
