# Newsletter preferences and instruction delivery

AUD-036 implements stored newsletter preferences, explicit email confirmation, unsubscribe and provider delivery/recovery. It does not issue the old advertised $20 coupon. No subscriber is enrolled from account registration, support-message permission, contact settings or historical email records.

## Customer workflow

The homepage Newsletter section and `/newsletter` request an email and permission to receive preference instructions. This permission is separate from agreeing to marketing: the recipient must open their email's confirmation link and explicitly select **Confirm subscription** to activate product-news/offers consent. Someone who only wants unsubscribe instructions does not need to agree to new marketing.

The initial API response acknowledges only a stored request reference/time. It does not expose whether an address is already subscribed or claim inbox delivery/activation. Pending, failed and withdrawn preferences must not receive marketing. An existing active recipient receives a management message containing a current unsubscribe link instead of another activation.

Before sending a request, the form preserves its normalized email, permission and UUID in tab session storage. Unknown responses retain that exact request through reload; retries do not create another subscriber or replace the request's content. A successful receipt replaces the local email/intent record. Confirmed validation/size/content-type rejections or exhausted delivery attempts may be explicitly replaced. Storage faults are visible and block a new send rather than silently losing the original request.

Confirmation links expire at the UTC time displayed in the email. A fresh generation lasts 24 hours; pending resends may reuse an existing valid generation and retain its original expiry. Replaced/expired links cannot activate a later generation. Opening a link performs no preference mutation: email scanners and GET requests do not subscribe or withdraw consent.

Email capabilities use fragments (`#token=...`), separate confirmation/unsubscribe HMAC domains and the configured application origin. The action page captures the capability in memory, removes the fragment/query from the address bar and requires a button press before POST. Tokens are not rendered, persisted in browser storage or returned by public request/admin-list responses. A new fragment opened in the same page replaces the old action state and aborts stale work. The pages/API use no-referrer policy and the preference pages have noindex metadata.

**Unsubscribe** withdraws the current preference idempotently. An older unsubscribe capability remains usable after subsequent requests, so the recipient can stop a later preference through an earlier message. A withdrawn preference requires a new confirmation generation before reactivation; replaying the old confirmation fails. These operations do not change store accounts, orders or OTP credentials.

## Delivery worker and configuration

The web request attempts the first instruction email using the existing configured Nodemailer transport. SMTP acceptance records SENT for that instruction request; it does not prove inbox placement or marketing consent. Configuration, transport and recipient-rejection failures retain safe status/error evidence and return unavailable. The user can retry their original request. Background processing also recovers failed/crashed attempts.

Configure the application using its existing private settings:

- `APP_URL`: canonical HTTPS application origin, or loopback in local tests.
- `OTP_SECRET`: existing private signing key; newsletter HMACs are domain-separated from OTP use. Key rotation invalidates old capabilities. Existing active recipients can request a newly signed management link after rotation.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: private transport configuration. Port 465 uses implicit TLS; other ports require STARTTLS. Public support-contact settings do not configure these credentials.
- `CHECKOUT_SWEEP_SECRET` and `CHECKOUT_SWEEP_DATABASE`: existing maintenance credential and exact application database target.
- `TRUSTED_PROXY_SECRET`: distinct trusted-ingress assertion secret.

Run a separately supervised worker after injecting its environment:

```powershell
npm run worker:newsletter
```

The worker needs `CHECKOUT_SWEEP_ORIGIN`, `APP_URL`, `CHECKOUT_SWEEP_SECRET` and `TRUSTED_PROXY_SECRET`. It does not need SMTP credentials: mail is sent by the authenticated application endpoint. The target application's database must match `CHECKOUT_SWEEP_DATABASE`. In prepared standalone/Docker output, the packaged command is:

```powershell
node scripts/newsletter-delivery-worker.mjs
```

The worker polls `/api/internal/newsletter/deliver` every ten seconds. Each invocation admits at most one instruction delivery. It requires both signed ingress and independent maintenance Bearer authentication; a browser cookie or unsigned Bearer alone is insufficient. HTTPS is required outside loopback, redirects are rejected, requests have a timeout and only validated aggregate counters are logged. Supervise/restart the process as part of deployment; opening a browser does not start it.

## Failure and recovery

Claims lock the subscriber before its delivery request, then commit a unique 90-second lease and cumulative attempt count. SMTP runs after releasing database locks. A live lease excludes a competing claim; expired leases may recover and stale completion cannot replace a newer lease. Explicit UTC clock reads and PostgreSQL epoch checks cover the installed adapter/timezone boundary.

Failures retain generic CONFIGURATION/TRANSPORT/REJECTED codes and exponential retry. Exhausted attempts become DEAD. Withdrawn/replaced/expired pending deliveries become SUPPRESSED; that does not claim an email was delivered. Correct provider/configuration problems, keep the worker running for eligible retries, and ask the recipient to request fresh instructions for DEAD/expired requests. The administration screen does not manufacture fresh consent or force an old confirmation valid.

SMTP is not exactly-once delivery. A timeout may occur after provider acceptance; recovering an uncertain lease may resend the same capability/message identity. An already in-flight message cannot be recalled by unsubscribe. Such a message does not reactivate withdrawn consent: the capability action still validates the current preference/generation. Maintenance HTTP timeouts and SMTP connection/greeting/socket limits are separate; a worker timeout does not prove a provider never received the message.

## Administrator view

Open `/admin/newsletter` through administrator navigation. Subscriber consent and instruction delivery have separate explicit filters, actual whole-view counts and 20-record pages. The subscriber view shows request-consent policy/time, confirmation and withdrawal timestamps. Only ACTIVE represents confirmed marketing permission. The delivery view shows actual attempts, lease/due/acceptance times and safe error notes. SENT refers to instruction-mail SMTP acceptance, not a campaign report.

Every read requires a current verified administrator/session and expected viewer header; role/session authority is rechecked under a database lock. Draft filters do not silently replace the applied view. Failed reads retain an explicitly unconfirmed prior view, malformed counts are rejected, and account/authority changes remove cached private addresses and abort requests. Neither nonces, HMAC capabilities, request hashes nor lease tokens are sent to this screen. This task does not provide campaign composition, bulk export or a fabricated broadcast result.

## Migrations and local verification

Readiness target: migration 35, `20261103160000_newsletter_consent`. It adds subscriber/request/event tables and transition/retention/evidence guards. It does not backfill newsletter consent. A 34-to-35 rehearsal preserves existing verified accounts, support messages, public contact values and their evidence without enrolling those addresses. Earlier local application fixtures are preserved.

With an isolated local `audit_*` database:

```powershell
npx prisma migrate deploy
npx prisma generate
npx jest --runInBand
npm run build
npx tsc --noEmit
npx prisma validate
npm run smoke:newsletter
```

Run TypeScript after the build has finished generating route types. The native smoke requires an installed OpenSSL executable (PATH on Linux/macOS, or Git's bundled executable/PATH on Windows). It generates a short-lived local CA/certificate in a newly owned temporary directory, trusts it only in its spawned application process, runs a loopback STARTTLS/authenticated SMTP fixture and rejects recipients outside `.invalid`. It never changes the operating-system trust store or uses a live mail account. Private keys/messages/capabilities are not printed; teardown closes owned processes/sockets and removes only the checked owned temporary directory.

The smoke exercises the real compiled application and Nodemailer TLS transport, real Redis fixture, actual password cookies, subscription/management mail, explicit token actions, exact retries, withdrawal/reconfirmation, actual SMTP rejection, packaged worker recovery, dual authentication, private admin scopes/revocation and safe logs. These local protocol/automated UI checks do not certify hosted inbox delivery, interactive-browser flows or production rollout; those remain AUD-044. The original exposed SMTP credential still requires the owner's separate external revocation under AUD-051.
