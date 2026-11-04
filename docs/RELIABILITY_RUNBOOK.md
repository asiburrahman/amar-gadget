# Reliability operations and OTP clock transition

Implementation evidence and limits are in [RELIABILITY_IMPLEMENTATION_NOTES.md](RELIABILITY_IMPLEMENTATION_NOTES.md). AUD-042 does not certify hosted services, a production rollout, every database constraint or browser flows; AUD-044/049 retain those release checks.

## Schema and OTP rollout

The required schema is migration **36**, `20261104100000_otp_utc_clock_guard`. The 35 earlier migrations are unchanged. This migration has been exercised only on isolated local databases; it has not been applied to production.

For a separately approved production rollout, back up the database and retain a restore plan, quiesce OTP traffic/old instances, apply reviewed migrations, deploy the matching artifact, check readiness and validate test-only signup/reset/retry before restoring traffic. Do not run migration commands against an existing production database merely to reproduce local evidence.

Migration 36 deliberately invalidates existing short-lived OTP tokens. Users must request a new code after rollout. It preserves account/password/session/order/financial records and every consumed OTP send/verification allowance. Existing throttle windows start one conservative ten-minute window; an existing resend timestamp retains the normal one-minute cooldown. This can temporarily delay an already throttled user; it does not replenish their spent attempts.

The UTC reader requires both enabled database clock guards before issuing/verifying/consuming codes. Against an older schema or disabled guard it fails closed before interpreting legacy timestamps. After migration, token/throttle guards reject future wall-clock writes from outdated instances. New issue, verification and delivery clocks use explicit UTC; default OTP timestamps are also UTC. Existing financial/order history is never shifted or reinterpreted by this migration.

The clock finding concerns the installed adapter's raw `timestamptz` result under a non-UTC database session. Do not infer that all stored dates are shifted. A separate guarded probe using the actual application Prisma client found a zero-second delta for a newly created account despite an Asia/Dhaka database session. Normal ORM-created timestamps and raw clock reads must be evaluated separately.

## Health and failure triage

- `/api/health` is liveness. A 200 does not prove database/Redis readiness.
- `/api/health/ready` requires valid runtime configuration, the completed required migration, enabled OTP clock guards, critical table/column readability and Redis PONG. It reads no customer/contact/order records. It is not a complete constraint/data audit.
- Readiness is coalesced per worker and cached for five seconds. Failure/recovery may therefore remain cached for that interval. Database connections/queries/statements and Redis transport have explicit timeouts; actual stalled-connection recovery is covered by the native smoke.
- A failed readiness check returns 503 with booleans and safe reference IDs, never endpoint credentials, SQL or account data. Match the reference with JSON stderr records whose event is `operation_failed`. Records contain only reference, static operation and allowlisted category.
- Page/API service failures carry the same kind of reference. Genuine missing/invalid resources and revoked sessions remain distinct. A failed collection must not be interpreted as an empty store or used to perform a destructive bulk operation.

For an unavailable session, `/api/auth/me` returns 503 without claiming the user is signed out. The browser hides cached private data, locks cart/wishlist scopes, and shows a verification retry. Guest state resumes only after an explicit successful signed-out response; a confirmed authenticated response resumes that account. Do not clear cookies or manufacture a client account to work around an outage.

Homepage section failures preserve healthy sections and identify unavailable sections with reload/reference controls. Product and taxonomy retries retain valid search/page filters. Administrator/seller/customer collection navigation uses whole-scope counts, not totals computed from the loaded page.

Financial reconciliation uses exact database aggregates over complete dispute/shipment/refund groups. Display pagination must never truncate those calculations. Oversized/incomplete provider history retains operator-review behavior. Historical orders beyond the supported 100-line purchase policy retain the existing explicit finance-review guard; these records are not deleted or silently repriced.

## Reproduce isolated checks

Use only a disposable loopback `audit_*` PostgreSQL database for `TEST_DATABASE_URL`. The test helpers reject other targets. The native scripts create their own randomly named databases, apply all checked-in migrations, close their services and drop only the database created by that invocation. They do not migrate or reset the input database. Earlier local fixtures are retained.

After dependencies/configuration and the isolated test database are prepared:

```powershell
npx prisma validate
npx tsc --noEmit
npx jest --runInBand
npm run build
npm run smoke:reliability-collections
npm run smoke:reliability-outages
npm run smoke:otp-clock
npm run smoke:refunds
git diff --check
```

Do not run TypeScript while a build is regenerating `.next/types`. Build before native smokes, and rerun the relevant smoke when the compiled behavior changes.

The collection smoke checks actual compiled HTTP/RSC pages and APIs. The outage smoke interrupts only its test TCP proxy/Redis boundary, temporarily renames a table in its own database, and verifies recovery without restarting the application. It does not stop PostgreSQL or affect the primary fixture. The OTP smoke uses a local STARTTLS SMTP server, an ephemeral local certificate authority and `.invalid` recipients; it confirms transport acceptance and application verification, not inbox delivery. The refund smoke uses an isolated TLS provider boundary with the real SDK, not hosted Stripe or real money. Browser walkthrough and configured hosted-service verification remain separate release work.

Do not publish raw server output, OTPs, mail bodies, cookies, database URLs or provider credentials as portfolio evidence. Use validated check summaries, code/commit links and safe incident references. The earlier exposed SMTP credential still requires the owner's external revocation; changing application code does not revoke it.
