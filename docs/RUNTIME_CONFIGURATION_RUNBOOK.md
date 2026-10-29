# Runtime configuration, startup and readiness

AUD-040 replaces conflicting validators with `config/runtime.ts`. The complete startup schema and individual database/JWT/OTP/SMTP/Stripe/R2/Redis/sweep helpers reuse its rules. Errors name invalid fields without logging values or nested provider/validation exceptions. Unused NextAuth/OAuth settings and the hosted-Checkout-unused publishable key are removed from the setup contract.

## Required settings

Every runtime needs a PostgreSQL TCP `DATABASE_URL`, distinct `JWT_SECRET` and `OTP_SECRET` values of at least 32 bytes, and an `APP_URL` origin. Generate private random keys; do not use documentation examples as credentials. Passwords/secret values are not trimmed or silently substituted. `DIRECT_URL` is optional for migration tooling. The application's former alternate database-variable fallbacks are removed.

`APP_URL` must be an origin without credentials, path, query or fragment. External origins require HTTPS; HTTP is accepted only for loopback testing/local deployment. Checkout creation/resume use this value rather than the incoming host or a build-time public variable. SEO-wide domain/URL reconciliation remains AUD-043.

Production requires complete groups:

- Ingress: a distinct `TRUSTED_PROXY_SECRET`, shared privately with the loopback gateway and authorized reservation worker. Deploy through the [trusted ingress runbook](TRUSTED_INGRESS_RUNBOOK.md); unsigned production application requests are rejected.
- Redis: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Mail: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Port defaults to 587; 465 uses implicit TLS and other ports require STARTTLS. Sender/host/port validation matches the actual mail transport.
- Card payments/reservation supervision: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CHECKOUT_SWEEP_SECRET`, `CHECKOUT_SWEEP_DATABASE`. The sweep key must be distinct from JWT/OTP keys, and the target must match the database name in the connection URL. Deploy/supervise the worker separately as described in the reservation runbook; startup validation does not run that worker for you.
- Storage: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`. The account ID must be a 32-digit hexadecimal account identifier. The public URL is the bucket's public origin without path/query/fragment; see [direct product-image uploads and CORS](PRODUCT_IMAGES_RUNBOOK.md).

In development a service group can be entirely absent, but partially enabled groups are rejected. Missing Redis retains the explicit development-only limiter policy; production cannot boot without it. Configured Redis requests have a fresh two-second abort signal and no automatic retry. Provider failures remain fail-closed in production.

The schema checks configuration, not external ownership/authentication at every vendor. Actual authorized SMTP, Stripe and R2 operations remain release verification; no mail or financial operation is performed at startup.

## Supported production entry points

Use `npm run build`, then either:

- `npm start` in the source workspace. The launcher explicitly loads a private workspace `.env` if it exists; otherwise it uses injected environment variables.
- `node start.cjs` inside the prepared standalone artifact. Inject runtime environment variables; the Docker image uses this same entry point.

The generated `start.cjs` forces production mode, clears build/bypass markers and runs the compiled startup validator **before** opening the Next listener. Invalid configuration exits nonzero with field names only. `instrumentation.register` also protects the framework request lifecycle. Build-only validation skipping uses Next's actual build phase; `SKIP_ENV_VALIDATION` has no runtime permission.

The installed Next 16.4.3 server source prints its Ready banner before loading configuration, and its eager prepare path can log an instrumentation error without exiting the listener. A banner alone is therefore not sufficient evidence of successful startup. The explicit production preflight entry point avoids that ambiguity. Direct execution of the generated `server.js`/`next start` is not the supported deployment entry point for this repository.

## Build and private configuration separation

An actual generated standalone `.env` was observed during this work without reading or publishing its content. Next copies build dotenv files into standalone output. The build's preparation step removes those files, rejects unexpected non-file dotenv artifacts, copies `public` and `.next/static`, and writes the preflight entry point. It changes only generated output; the source workspace's private files remain untouched. Docker ignores all `.env*` inputs except the empty-value example template. Do not invoke raw `next build` and deploy its unprepared directory.

Use runtime environment injection or an explicitly supplied private runtime env file. Do not restore a copied build-time env file to make configuration checks pass. Missing private configuration is an operator setup error, not a reason to add default signing keys or silent service fallbacks.

## Liveness and readiness

`GET /api/health` reports process liveness only. `GET /api/health/ready` returns 200/READY only when runtime configuration is valid, the database has the build's required completed migration, and Redis PING succeeds. Otherwise it returns 503/UNAVAILABLE with boolean checks. Results contain no connection URL, identity, SQL, key or provider exception, and both endpoints disable HTTP caching.

Readiness uses a dedicated one-connection PostgreSQL adapter pool with 1.5-second connection/query/statement bounds and the same two-second Redis bound. Per-worker probes coalesce and cache their result for five seconds to bound repeated unauthenticated probes. A state change can therefore take up to that cache interval plus probe time to appear. The required migration constant has a test against the latest checked-in migration; advance it whenever a reviewed migration is added.

Route traffic according to readiness. A database/Redis outage should not be mistaken for a healthy empty store, and a liveness response does not certify vendor delivery, payment/storage connectivity or the entire marketplace. Broader correlated logging/query/error-state work remains AUD-042/044.

## Verification boundary

Unit cases cover required settings, old bypass flags, shared secret byte rules, key reuse, origin/sender/port checks, redacted errors, incomplete service groups, wrong sweep target, migration alignment, readiness failures/coalescing/cache and liveness separation.

The runtime smoke launches the actual prepared artifact with isolated configuration, checks dotenv exclusion and nonzero startup rejection for missing JWT/Redis/origin/storage despite the old skip flag, and distinguishes a closed local database port from process liveness. The full standalone smoke uses actual password hashing, login/JWT/SQL, packaged assets and the real Upstash SDK against a test-only local REST fixture. It proves configured readiness and Redis-outage 503/liveness 200, plus copied-cookie revocation. No provider fixtures are imported by application code or shipped by the Docker runtime. Fixture accounts/processes are cleaned up. These are local HTTP/server tests, not claims of a hosted browser walk-through or actual Upstash/SMTP/Stripe/R2 operation.

No production secrets, database, deployment, provider account or credential-revocation state was changed. AUD-051 remains open: on 29 October 2026 the owner confirmed the exposed SMTP credential had not yet been revoked.
