# AUD-044 release verification

Status: AUD-044 implemented and verified locally and by both PostgreSQL 16/18
GitHub verification jobs. The separate repository lint gate remains red under
AUD-045; the entire release is not yet green. This task does not certify a
production deployment or hosted Stripe, Cloudflare, SMTP or Upstash accounts.

## Required evidence

The original audit requires disposable database migration/seed verification,
transaction rollback/concurrency, role/ownership rules, coupon quotes, signed
duplicate/expiry/cancel webhook coverage, browser cancellation/uploads/critical
navigation, and CI build/type/lint/test gates. Existing tests are retained;
passing browser navigation cannot replace the financial integration tests.

The real PostgreSQL marketplace transaction suite covers rollback, concurrent
last-unit purchases, repeated checkout attempts, owner/guest capabilities,
coupon and changed-price quote checks, signed duplicate/expiry events, worker
authorization, payment/expiry races and safe checkout cancellation. Separate
fulfillment, refund, settlement and profile tests cover role/ownership and
durable financial mutations. The isolated runner executes the complete Jest
suite with a mandatory local test database and rejects skipped suites/tests.

`test:isolated` creates a random database using the existing guarded fixture,
runs actual `prisma migrate deploy`, executes `prisma db seed` twice, checks
five categories/five brands with no seeded accounts/products/orders, executes
the full Jest suite and drops only its newly owned database. It never migrates
or drops the control database supplied by the operator.

## Browser scope

`npm run test:browser` uses the compiled production/standalone application,
real PostgreSQL and an independently created database per browser worker.
The projects cover desktop Chromium, Firefox, WebKit and mobile Chromium.
They run sequentially, with no automatic retries masking a failure.

- Guest product navigation, cart persistence and category/brand/compare/
  wishlist/contact pages.
- A deliberately delayed JavaScript load proves sign-in controls remain
  disabled before hydration and the first entered credentials survive it.
- Actual login, coupon validation and COD checkout, with the recorded owner,
  items, payment state and server total checked in PostgreSQL.
- Actual card reservation creation and cancellation, with stock restored once
  across reloads and the guest cart retained.
- Customer denial at administrator/seller workspaces and administrator
  navigation into actual operations screens.
- Seller file selection, a real failed storage request, explicit retry,
  actual signed image bytes/decoding/receipt attachment and a pending product
  that remains absent from the public API and rendered product page.

The browser uses a self-signed loopback HTTPS listener connected to the real
production ingress handler with a random test secret. Secure authentication
and receipt cookies remain enabled in every browser. Only the local test
certificate's trust error is ignored. The real S3 SDK's test-process
preload redirects transport to a loopback SigV4-verifying storage fixture.
Browser upload bytes are forwarded to that same verifier; application upload,
receipt, product and authorization handlers are not replaced with mocks.
The final upload bridge continues the browser's original network request and
pipes its actual body to storage. An earlier JavaScript `postDataBuffer()`
forwarder could not read WebKit's File-backed XHR body, causing the verifier to
correctly reject its missing signed content length. No test substitutes the
original selected file for missing browser bytes.
All other external browser requests are blocked. This verifies application
behavior without claiming public DNS/TLS/bucket CORS or hosted card processing.

Next's installed not-found guide explicitly permits HTTP 200 once streaming
has started. Private product checks therefore inspect the rendered not-found
boundary, absence of the product heading, noindex and the separate public
JSON endpoint's 404; a streamed status alone is insufficient.

## Startup and CI

The shared standalone fixture now waits for an HTTP 200 `READY` result with
configuration/database/Redis checks all true. The deadline is bounded; a Next
startup banner alone cannot pass. Tests deliberately starting with a database
outage explicitly opt out and assert the failure themselves. Native tests
cover transient 503s, a false healthy envelope, an expired deadline, a dead
child and rejection of non-loopback origins.
The OTP guard smoke now accounts for the readiness probe's existing five-
second cache before asserting a schema fault; OTP mutations must still fail
immediately. Its first run after adding startup readiness correctly exposed
that outdated test assumption, and the corrected run passed.

The GitHub workflow runs on main/audit branch pushes, pull requests and manual
dispatch. It grants read-only repository access, uses an ephemeral PostgreSQL
service with fixture-only credentials, and runs separate full-repository lint
and verification jobs. Verification includes Prisma, mandatory real database
Jest, native ingress/readiness tests, TypeScript, production build, compiled
collection/outage/OTP/refund smokes, and all browser projects. Compiled smokes
are sequential to avoid startup resource contention. No `continue-on-error`,
skipped financial tests or production secrets are used.

The lint gate intentionally runs the full repository command. Existing lint
debt belongs to AUD-045 and must be repaired before claiming all release gates
are green. Branch protection is an owner/repository setting, separate from
adding a workflow; this task does not silently enable a merge policy.

Failure screenshots/traces and Jest JSON use only synthetic fixture data.
They are ignored locally and retained as CI artifacts for seven days. No
production database, real customer, credentials or hosted service belongs in
these runs.

## Local reproduction

Use a running local PostgreSQL control database named `audit_*` whose role can
create databases. Export its URL as `TEST_DATABASE_URL`; never use a production
URL. The fixture enforces loopback and the name guard. Node must satisfy the
repository engines. OpenSSL is required for the local STARTTLS fixture.

```sh
npm ci
npx prisma validate
npm run test:isolated
npm run test:native
npx tsc --noEmit
npm run build
npm run smoke:reliability-collections
npm run smoke:reliability-outages
npm run smoke:otp-clock
npm run smoke:refunds
npx playwright install chromium firefox webkit
npm run test:browser
npm run lint
```

On Linux, install browser operating-system dependencies with
`npx playwright install --with-deps chromium firefox webkit`. Open reports with
`npx playwright show-report`; never commit generated authentication state,
traces or test reports. The initial local Chromium runs exposed test setup
issues (waiting for completed cart writes, an ambiguous price label, assuming
every page uses a main landmark, and treating streamed not-found as a literal
HTTP 404). WebKit also rejected Secure cookies over plain loopback HTTP;
the fixture now uses actual HTTPS instead of weakening application cookies.
On HTTPS, WebKit exposed a separate first-input hydration race: an enabled
server-rendered email field accepted typing before React attached its handler,
then the controlled input reset and login sent an empty email. The actual login
page now enables its credential fieldset only after hydration, with a delayed-
JavaScript browser regression test. This is an application fix, not a test sleep.
An uncaught-browser-error assertion then exposed React hydration error 418
after authenticated reloads in all engines: the client auth store bootstrapped
from localStorage while SSR rendered an unknown session. The auth store now
starts with `user: null, loading: true` on both sides and publishes identity
only after session verification. New unit regressions cover a cached admin
profile and replacement by the actual verified account; browser authenticated
reloads remain subject to the uncaught-error gate.
WebKit also reports some same-origin fetches during document replacement as
`pageerror` network diagnostics. The harness does not silently ignore them:
it requires an actual successful browser fetch to each exact same-origin URL.
Arbitrary JavaScript exceptions and external CORS failures still fail the run.
Corrections preserve the original behavioral assertions.

## Verified local results (4 November 2026, Asia/Dhaka)

- Complete isolated run: **161 Jest suites / 1,190 tests passed**, zero skipped
  tests/suites. Actual migration deploy and the twice-idempotent seed passed.
- **28 browser tests passed** across the three desktop engines and mobile
  Chromium, zero unexpected/flaky/skipped results, no Playwright retries.
- **11 native ingress/readiness/unsafe-target tests passed**.
- TypeScript, Prisma validation and the final production/standalone build
  passed. The final built artifact passed all 23 compiled collection, outage,
  STARTTLS OTP and refund checks. Additional runtime/SEO checks passed earlier
  in this task before the client auth-snapshot correction.
- Changed-code lint has zero errors and seven pre-existing internal-navigation
  warnings in the login page. The repository inventory after excluding only
  generated browser reports contains **25 errors / 37 warnings**, owned by
  AUD-045. The CI lint job must expose that debt, not bypass it.
- Workflow YAML parses, and action references are pinned to reviewed commit
  SHAs. Generated test reports and credentials are not committed. No earlier
  migration was changed, and no production migration/deployment/main merge ran.

The final full Jest run took 504.092 seconds; the final browser run took 4.8
minutes on this local host. These are observed verification durations, not
application performance measurements or a remaining-work ETA. Initial failed
runs above remain part of the engineering record; they are not presented as
passing evidence. GitHub verification evidence will be appended after push.

## First remote CI run and portability correction

[Run 41833384558](https://github.com/asiburrahman/amar-gadget/actions/runs/41833384558)
executed the full suite on GitHub's PostgreSQL 16 fixture: 160 suites / 1,189
tests passed, one purchase-retention migration assertion failed. PostgreSQL 16
returned `23503` (foreign-key violation) where the PostgreSQL 18 local fixture
returned `23001` (restrict violation). The assertion had required only the
latter. Both identify an integrity constraint, not successful deletion.

The corrected regression accepts only those two native codes for the exact
`OrderItem_productId_fkey` constraint, then independently proves the product,
stock and both original/captured receipt labels remain intact. The local
PostgreSQL 18 regression passes. The CI matrix now tests PostgreSQL 16 and 18
separately, with independent artifacts and fail-fast disabled, so the provider
variation remains visible rather than narrowing verification to one version.
No database constraint or migration was loosened or changed. The first lint
job correctly failed on AUD-045 debt. AUD-044 remains open until the corrected
remote verification is checked.

## Remote verification completed

[Corrected run 41834749145](https://github.com/asiburrahman/amar-gadget/actions/runs/41834749145)
verified commit `8d8ebe213eab4def253dc123b24d8c86dfbe751c`:

| Verification job | Full Jest | Native | Real browser cases | Result |
| --- | --- | --- | --- | --- |
| [PostgreSQL 16](https://github.com/asiburrahman/amar-gadget/actions/runs/41834749145/job/126590662803) | 161 suites / 1,190 tests, no skips | 11, no failures | 28 passed | Success |
| [PostgreSQL 18](https://github.com/asiburrahman/amar-gadget/actions/runs/41834749145/job/126590663223) | 161 suites / 1,190 tests, no skips | 11, no failures | 28 passed | Success |

Both jobs also passed Prisma validation, TypeScript, the production/standalone
build and all compiled collection/outage/STARTTLS OTP/refund checks. The logs
were inspected for the actual Jest/native/browser summaries; job success alone
was not substituted for those counts. The independent lint job failed on
recorded AUD-045 debt. No failed gate was reclassified as passing.

AUD-044 is now complete within its implementation/testing scope. The tracked
count is **47 of 51 implemented**; AUD-045, AUD-046, AUD-049 and the owner's
external AUD-051 credential revocation remain. CI must be fully green after
lint remediation before claiming overall release verification.