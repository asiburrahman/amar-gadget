# Amar Gadget (আমার গ্যাজেট)

A multi-vendor electronics marketplace with customer, seller and administrator workflows, built with Next.js App Router and PostgreSQL.

আমার গ্যাজেট একটি মাল্টি-ভেন্ডর ই-কমার্স প্রকল্প। এই রিপোজিটরিতে স্টোরফ্রন্ট, অ্যাকাউন্ট, অর্ডার, পেমেন্ট, সেলার পরিচালনা এবং অ্যাডমিনের কাজের কোড ও পরীক্ষার প্রমাণ রাখা হয়েছে।

[![Verification](https://github.com/asiburrahman/amar-gadget/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/asiburrahman/amar-gadget/actions/workflows/verify.yml)

The audit branch was merged into main on 6 November 2026 in [be65fcd](https://github.com/asiburrahman/amar-gadget/commit/be65fcd4a624f4f4098f59131f752ad79e5fac13), preserving its individual task commits. The public [codex/deep-audit-2026-10-28 branch](https://github.com/asiburrahman/amar-gadget/tree/codex/deep-audit-2026-10-28) remains available as contribution evidence. The current tracked status is **50 of 51 tasks completed**; only AUD-051 awaits the owner's SMTP credential revocation confirmation. AUD-049 passed local verification and all three source CI jobs. See the [task schedule](docs/IMPLEMENTATION_SCHEDULE.md) and [implementation log](docs/CODEX_IMPLEMENTATION_LOG.md).

The owner-supplied deployment address is [amargadget.gmksolution.com](https://amargadget.gmksolution.com). Its availability and hosted provider behavior have not been certified by the local verification recorded here. This README does not claim production readiness, throughput, customer counts, delivery times, warranty coverage or a successful live payment.

## Implemented workflows and verification boundaries

“Implemented” describes connected application behavior and its recorded local tests. A configured hosted deployment, provider acceptance, backups and a reviewed rollout remain separate requirements.

| Area | Application behavior | Operator setup or remaining boundary |
| --- | --- | --- |
| Catalog | Public visibility requires approved products and eligible sellers; category hierarchy, brands, search, filters, sorting, compare and server pagination | Supply actual catalog information; no seeded products or invented stock/customer metrics |
| Accounts | Verified email registration, password reset, JWT cookies, current-session revocation, role and ownership checks, profile/address management | SMTP delivery and private administrator provisioning |
| Cart and wishlist | Persistent guest and account state, owner isolation, cart reconciliation, browser-lock recovery and bounded server reads | Browser/device behavior is exercised in the release workflow; no cross-device synchronization promise while offline |
| Checkout | Server-derived identity, prices, coupons and totals; idempotent attempts; stock reservation and payment retry | PostgreSQL TCP, canonical application origin, Redis and the reservation worker |
| Payments | Stripe-hosted Checkout with verified webhook confirmation; Cash on Delivery | Configured Stripe test/live account and webhook; client redirects never prove payment |
| Fulfillment | Seller-scoped shipments; administrator delivery and per-shipment COD collection confirmation | Admin confirms actual collection; the order is paid only after all required shipment collections |
| Refunds | Full-order and item/quantity requests, audited decisions and Stripe reconciliation | Before dispatch: eligible shipping refund and stock restoration; after dispatch: shipping excluded and stock restored only after receipt/inspection. Admin records external COD refund method/reference |
| Seller settlement | Configurable commission and shipping allocation, retained calculation evidence, balances and payout decisions | Eligible after delivery and collected payment. Admin initiates external payout and confirms its payment reference |
| Administration | Product/vendor moderation, taxonomy, coupons, banners, users, reports, financial metrics and notification history | Current administrator authority is checked on the server; commercial policies require operator configuration |
| Media | Direct R2 product/avatar uploads, validation, finalization and supervised cleanup | R2 permissions, public origin and browser CORS; application code does not promise CDN compression or zero end-to-end egress cost |
| Support | Persisted inquiries, private support queue, dashboard-managed published contact information | Enter verified public email, phone, address and support hours in `/admin/settings/support`; these fields do not configure SMTP |
| Newsletter | Consent, confirmation, unsubscribe and delivery/retry records | Configure SMTP and supervise the newsletter worker; a queued message is not reported as delivered |
| Public content | Reviewed page/article publication, private drafts, exact decision receipts and retained revision history | `/admin/settings/content`; publish actual operator information. No operator policies or sample articles are seeded |
| Reliability | Safe incident references, explicit outage states, bounded queries, schema/Redis readiness and verified database constraints | Monitor readiness/workers and rehearse the documented production rollout |
| Verification | Real PostgreSQL tests, compiled HTTP checks, four browser projects and GitHub CI | Local provider fixtures prove protocol/application behavior, not hosted Stripe/R2/SMTP account acceptance |

There is no subscription billing or Stripe customer portal. The legacy portal endpoint returns an explicit `410` contract directing callers to order history and support. Refund and payout actions do not simulate money movement.

## Stack and layout

The lockfile currently pins Next.js **16.4.3**, React **19.2.9** and Prisma **7.10.1**. The application uses TypeScript, Tailwind CSS v4, Zod, Zustand, `jose`, Nodemailer, Stripe, the AWS S3 SDK and Upstash Redis.

Prisma uses **`@prisma/adapter-pg` over PostgreSQL TCP**, including a compatible Neon TCP connection. The Neon HTTP adapter cannot execute the interactive transactions required by checkout, OTP and financial operations; it is not the application's database transport.

```text
app/
  (auth)/                  Registration, login, OTP and recovery
  (marketing)/             Storefront, checkout and public information
  (dashboard)/             Admin, member/seller and customer areas
  api/                     Authenticated APIs, public reads and webhooks
components/                Forms, catalog, dashboards and shared UI
config/                    Validated runtime configuration
lib/                       Transactions, policies, storage and service logic
server/actions/            Server actions with server-side authority checks
stores/                    Browser account, cart and wishlist state
prisma/schema.prisma       Database models
prisma/migrations/         Versioned SQL, including database guards
prisma/seeds/seed.js        Reference categories and brands only
scripts/                   Operator workers, checks and fixture runners
tests/                     Unit, PostgreSQL, native and real browser checks
docs/                      Audit, task evidence and operational runbooks
```

## Local development

Use a Node.js version supported by `package.json`: `^20.19.0`, `^22.12.0` or `>=24.0.0`. CI uses Node 22. Use npm and the committed `package-lock.json` for reproducible installs.

```sh
git clone https://github.com/asiburrahman/amar-gadget.git
cd amar-gadget
git switch codex/deep-audit-2026-10-28
npm ci
```

Copy `.env.example` to `.env`. In PowerShell:

```powershell
Copy-Item .env.example .env
```

In a POSIX shell:

```sh
cp .env.example .env
```

Fill the private file with your own configuration. Do not commit it. The [runtime configuration runbook](docs/RUNTIME_CONFIGURATION_RUNBOOK.md) specifies validation and required groups.

| Settings | Purpose |
| --- | --- |
| `DATABASE_URL`, optional `DIRECT_URL` | PostgreSQL TCP runtime and migration connection |
| `JWT_SECRET`, `OTP_SECRET`, `APP_URL` | Distinct private signing keys and exact application origin |
| `TRUSTED_PROXY_SECRET` | Separate private app/gateway ingress key for production |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | OTP and supervised outbound mail; 465 uses implicit TLS, other configured ports require STARTTLS |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe-hosted card checkout and signed webhooks |
| `CHECKOUT_SWEEP_SECRET`, `CHECKOUT_SWEEP_DATABASE` | Authorized reservation supervision, with the intended database name explicitly checked |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Product/avatar storage and validated public media origin |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting and runtime readiness |
| `MEDIA_CLEANUP_DATABASE`, optional `MEDIA_CLEANUP_ORIGIN` | Explicitly targeted media cleanup workers |
| Optional `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GTM_ID` | Public analytics identifiers, if configured |

Generate distinct private random keys of at least 32 bytes for JWT, OTP, ingress and sweep authentication. There are no default signing secrets. `NEXTAUTH_*` and a Stripe publishable key are not part of this application's setup contract.

Development may omit an entire optional provider group; partially configured groups are rejected. Features requiring that service remain unavailable until configured. Production startup requires the complete provider groups described in the runbook.

Apply migrations **only to a fresh disposable development database** for this first setup:

```sh
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run dev
```

Open [localhost:3000](http://localhost:3000). The seed is idempotent and creates five categories and five brands. It creates **no login accounts, products, orders, public policies or articles**. There is no root `seed.js` demo-product script.

Register customer/seller accounts through the application. Sellers require administrator approval. To provision an administrator, register the intended account first, privately configure `SEED_ADMIN_EMAIL` and a policy-compliant `SEED_ADMIN_PASSWORD` for the operator process, then run `npm run provision:admin`. This command targets an existing account, changes its role/verification/password and prints no credentials. Do not publish those values or assume a default demo login.

For an existing database, first review its migration state, data, backups and rollout plan. A database created with `prisma db push` is not automatically safe to migrate. This work has not applied migrations to a production database.

## Production processes and Docker

Build and run the prepared artifact:

```sh
npm run build
npm start
```

`npm start` uses `.next/standalone/start.cjs`, which validates runtime configuration before opening the listener. Build preparation removes copied dotenv files from generated output and packages public/static assets. Inject private runtime environment variables or use the explicitly loaded source-workspace `.env`; do not deploy a raw generated `server.js` or bypass the preflight.

Production application requests require the [trusted ingress gateway](docs/TRUSTED_INGRESS_RUNBOOK.md). The supported public chain is:

```text
Named Cloudflare Tunnel on the same host
  -> private loopback gateway :8080
  -> private Next standalone app :3000
  -> PostgreSQL / Redis / configured providers
```

Keep both listeners private. For native PowerShell, set `$env:HOSTNAME = "127.0.0.1"` before `npm start`. Run the gateway separately with injected environment (`npm run start:gateway`) or the runbook's explicit private env-file command. Use `GATEWAY_CLIENT_IP_MODE=socket` for direct local access; use `cloudflare-tunnel` only with the documented same-host named tunnel. Set `APP_URL` to the exact browser origin.

The Dockerfile builds a non-root standalone image. The following publishes the backend **only on loopback**; the configured gateway is still required:

```sh
docker build -t amar-gadget:local .
docker run --name amar-gadget-app -p 127.0.0.1:3000:3000 --env-file .env amar-gadget:local
```

Do not treat successful container startup as a completed deployment. Docker image construction, hosted tunnel routing, provider acceptance and production rollout need their own verification. `.dockerignore` excludes private dotenv inputs; no Docker build result is claimed by the latest recorded local checks.

`npm run tunnel:local` runs the operator's configured named Cloudflare Tunnel. It does not create a quick public tunnel to the application port. Development HMR is used directly on localhost; the production HTTP gateway rejects WebSocket upgrades.

Supervise the required workers independently. The app's web listener is not the complete runtime:

| Worker | Runbook |
| --- | --- |
| Checkout reservations | [Reservation lifecycle and supervisor configuration](docs/CHECKOUT_RESERVATIONS_RUNBOOK.md) |
| `npm run worker:refunds` | [Refund reconciliation](docs/REFUND_RECONCILIATION_RUNBOOK.md) |
| `npm run worker:media-cleanup` | [Product images](docs/PRODUCT_IMAGES_RUNBOOK.md) |
| `npm run worker:avatar-cleanup` | [Avatar storage](docs/AVATAR_STORAGE_RUNBOOK.md) |
| `npm run worker:notifications` | [Notification delivery](docs/NOTIFICATIONS_RUNBOOK.md) |
| `npm run worker:newsletter` | [Newsletter delivery](docs/NEWSLETTER_RUNBOOK.md) |

`GET /api/health` reports liveness. `GET /api/health/ready` checks configuration, the required completed migration and critical relations, OTP clock guards and Redis. Its bounded probes cache results for five seconds. Readiness does not certify every external provider or replace monitoring.

## Content administration

AUD-046 adds `/admin/settings/content` for About, FAQ, Returns, Privacy, Terms and blog articles. Drafts are separate from retained publication snapshots. Publishing requires an explicit review of a saved revision; editing a later draft does not rewrite the issued page. Decisions require reasons, current administrator authority and an exact retry reference. Withdrawal retains the history.

Enter real operator information and policies before opening the marketplace to customers. Where no operator document is published, the public page identifies that state and provides operational guidance and support links; it does not invent legal terms, delivery promises or a warranty. Unpublished articles return not found. Unpublished information guides are noindex and excluded from sitemaps. The homepage's marketplace summary uses the published About summary; public support contact details remain independently managed in `/admin/settings/support`.

See [content implementation and verification notes](docs/SITE_CONTENT_IMPLEMENTATION_NOTES.md). AUD-046 is implemented and verified in its separate public commit and CI run; operator-written policy content and hosted deployment remain the operator's configuration responsibility.

## Verification and public evidence

The latest completed baseline is AUD-049, commit [b9cf24f](https://github.com/asiburrahman/amar-gadget/commit/b9cf24f90a2aa2ce8623499ddbc00b8014cfb6ab), with a fully successful [GitHub CI run](https://github.com/asiburrahman/amar-gadget/actions/runs/42205423702). The inspected PostgreSQL 16 and 18 logs each show:

- 174 Jest suites and 1,287 tests, with no skipped tests.
- 16 native tests and 40 browser cases across Chromium, Firefox, WebKit and mobile Chromium.
- TypeScript, Prisma validation, production/standalone build and repository lint with zero errors/warnings.
- Actual CLI upgrade/invalid-data rollback and seven measured query-plan checks, plus compiled schema protection, collection, outage, local STARTTLS OTP, refund and content-publication checks.

These counts describe the complete CI-verified source commit. The earlier local full gate passed 1,280 tests; the expanded focused invariant suite then passed 28 cases, including seven additional boundary cases now included in CI's full 1,287-test run. Both PostgreSQL job logs were inspected, rather than inferring coverage from a green badge. See the [database rollout and evidence runbook](docs/DATABASE_INVARIANTS_RUNBOOK.md) for the exact scope. Test elapsed times are not marketplace performance measurements. Earlier failed runs are retained rather than presented as successful checks.

For the mandatory full database gate, create a **separate loopback control database** named `audit_*`, with an account permitted to create disposable test databases, and privately set `TEST_DATABASE_URL` to it. The runner creates and drops only its own random database, applies actual migrations, seeds twice, runs the entire Jest suite and rejects skipped tests. It does not reset/migrate the supplied control database.

```sh
npm run test:database-upgrade
npm run test:database-plans
npm run test:isolated
npm run test:native
npx tsc --noEmit
npx prisma validate
npm run lint
npm run build
npm run smoke:database-invariants
npm run smoke:site-content
npx playwright install chromium firefox webkit
npm run test:browser
```

Follow the [release verification runbook](docs/RELEASE_VERIFICATION.md) for the full compiled/provider checks and CI matrix. Running plain `npm test` without the guarded test database can skip database suites and is not release evidence. Browser/smoke runners use disposable synthetic accounts and local protocol fixtures; application code does not import those fixtures or fake provider success.

The owner-authorized main merge preserves the CI-verified application source; the later integration record changes documentation only. The badge above tracks main's own verification separately. No production migration, deployment, hosted money transfer or outbound customer email was performed by this audit. The exposed historical SMTP credential still requires the owner's provider-side revocation confirmation; removing a fallback from source does not revoke it.

## Contributing and attribution

Start with the [original deep audit](docs/DEEP_AUDIT_2026-10-28.md), [schedule](docs/IMPLEMENTATION_SCHEDULE.md) and the relevant operational runbook. Keep each audit task scoped, verify its actual frontend/API/database boundaries and record limitations. Never add production secrets or demo credentials. Open a pull request for review; this branch is not merged automatically.

Asibur Rahman owns the project. Implementation commits record `Assisted-by: OpenAI Codex`; the [case study](docs/CODEX_CONTENT_CASE_STUDY.md), code and test history document that collaboration. This is evidence of development work, not a claim of OpenAI endorsement, grant selection or hosted production certification.

No `LICENSE` file is currently checked into this repository. The previous MIT badge and broken license link have been removed; the owner can publish the intended license separately.
