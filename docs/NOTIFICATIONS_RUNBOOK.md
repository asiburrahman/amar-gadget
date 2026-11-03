# In-app notification delivery and role inboxes

AUD-033 provides durable source capture, leased/retryable background delivery, scoped inboxes, exact unread/read state and administrator recovery. The delivery channel is the application's inbox; a successful delivery means an actual stored inbox message. No additional email channel is advertised by this workflow.

## What each account sees

- `/user/notifications`: the customer's own ACCOUNT messages, including recorded order/payment/refund/dispute and account-access changes.
- `/member/notifications`: the seller's own ACCOUNT and SELLER messages, including applications/decisions, product decisions, assigned shipments/status, financial updates, payouts and future commercial-policy changes. A verified blocked/pending seller may read their own decisions with a current session; catalog, order-management and payout permissions remain separately enforced.
- `/admin/notifications`: that administrator's own ACCOUNT/SELLER notices and delivered ADMIN alerts for review and operational events. Global delivery administration is separate at `/admin/notifications/delivery`.

An account purchasing as a seller/administrator still receives its personal order messages. ACCOUNT notices survive role changes. Private SELLER/ADMIN audiences are filtered by the current verified database role, and old sessions are revoked when role/approval/verification changes. A former administrator cannot read or change those old privileged notices through a USER session. Current role routes redirect to the appropriate canonical inbox; navigation links the actual destination.

Messages describe a recorded update, which may precede a later status change. Their links open the current authorized pages. Captured order/product/shipment/payout references provide context without copying another seller's catalog fields, customer addresses, credentials or bank references. Product/financial version-only changes are not presented as new status decisions.

## Inbox operation

Inbox reads use real 20-record pages and kind/read filters. The unread count covers all delivered notices allowed for the current account/role, independently of the displayed filter. Marking a notice read/unread sends its saved revision; stale reversals are rejected. Repeating an already satisfied read decision is naturally idempotent. **Mark visible unread messages read** changes only the bounded visible set, and a mixed-ownership/stale batch changes nothing.

The visible tab refreshes every 30 seconds using its applied filters, preserving an unfinished filter selection. Responses are private/no-store. Failed reads retain an explicitly unconfirmed prior view and never invent an empty healthy inbox. Counts/read state reload from PostgreSQL after mutations. Account changes abort pending work; authorization/owner/role mismatches remove cached private rows and refresh the current session. Non-JSON proxy failures show a readable unavailable state rather than raw diagnostics.

## Run the delivery worker

Migration/readiness target: `20261103120000_notification_outbox` (migration 32). Fresh installation and an isolated 31-to-32 upgrade are rehearsed. Migration does not broadcast old source history as new messages or invent prior deliveries. No production migration/deployment occurred in this task.

Actual business/source changes enqueue NotificationEvent rows in the same transaction: verified seller applications/status, account role/verification updates, catalog review/status, order placement/status/payment, seller shipment assignment/status, refund status, provider dispute reconciliation, payout status and future commercial-policy revisions. A rolled-back business mutation rolls its outbox capture back. Source identities are unique; a conflicting payload cannot reuse the same source identity.

Inject these values through the worker's supervisor/secret manager:

- `CHECKOUT_SWEEP_ORIGIN`: the trusted HTTPS or loopback application/gateway origin to call.
- `APP_URL`: the canonical application origin used for ingress assertions.
- `CHECKOUT_SWEEP_SECRET`: the server's configured maintenance Bearer secret.
- `TRUSTED_PROXY_SECRET`: the distinct ingress assertion secret.

The server also requires `CHECKOUT_SWEEP_DATABASE` to match `current_database()` before delivery. The internal route requires both trusted ingress and its own Bearer credential; browser cookies do not authorize it. The explicit server-to-server origin exception does not permit Server Actions or unsigned requests.

After injecting the environment, run a separately supervised process:

```powershell
npm run worker:notifications
```

Inside prepared standalone/Docker output, use:

```powershell
node scripts/notification-delivery-worker.mjs
```

The build packages the worker and ingress protocol module. The worker polls `/api/internal/notifications/deliver` every 10 seconds, uses bounded request timeouts, rejects redirects, shuts down on process signals and logs only validated delivery counters. A trusted scheduler can POST the same endpoint with those authentication protections. It is not started implicitly by opening an inbox page.

## Retry, recovery and retention

The worker uses SKIP LOCKED and a unique 30-second lease; stale/expired tokens cannot deliver or overwrite another claim. Each transaction inserts at most 100 recipients, and inserts/checkpoint advancement commit together. The unique event/account key prevents duplicate inbox messages. A successful partial fan-out page resets consecutive failures, so large recipient sets do not exhaust the failure budget by making progress. Processing is bounded to 10 event claims and approximately 20 seconds of loop admission per handler invocation, with bounded database transactions.

Unconfirmed inserts roll back, retain the original event/checkpoint and use exponential retry up to eight consecutive attempts. Repeated failure or invalid immutable event data becomes DEAD. A removed source or no eligible recipient becomes SKIPPED, which does not claim delivery. A crashed lease is recoverable. Lease/retry Date arithmetic reads explicit UTC timestamps; PostgreSQL epoch assertions cover the installed adapter/host timezone boundary.

The administrator delivery page shows actual state totals, checkpoints, safe error codes, lease/due times and currently retained inbox row counts. Review the cause, select the saved event revision, record a reason and confirm a retry. Only RETRY, DEAD and no-recipient SKIPPED events are eligible; active claims and removed sources cannot be force-retried. Retrying preserves the completed cursor and records append-only actor/reason evidence. Repeated already-queued decisions do not add another retry instruction. A requeue is not a claim that delivery succeeded; inspect the resulting saved state.

Event content, delivered message content and retry evidence are retained/immutable. Read timestamps are server-authored UTC values with revision checks. Removing an owning account cascades its inbox rows; the outbox/retry evidence retains only its minimal identifiers and safe source payload. Stored-recipient counts therefore describe currently retained messages, rather than promising a permanent historical recipient census.

## Reproduce local verification

Use an isolated local `audit_*` database with TEST_DATABASE_URL, DATABASE_URL and DIRECT_URL configured appropriately:

```powershell
npx prisma migrate deploy
npx prisma generate
npx jest --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:notifications
```

The notification smoke creates/migrates its own random database and runs the actual packaged worker against the prepared server. It exercises real cookies, approval and compiled checkout sources, dual authentication, private role scopes, read-state revisions, a real injected PostgreSQL delivery failure, audited retry and post-role-change authorization. Controlled fixtures stay in tests/smokes. The implementation log records exact full-suite/build/native results. Interactive-browser and actual hosted-provider certification remain AUD-044; these local checks do not certify a production deployment.
