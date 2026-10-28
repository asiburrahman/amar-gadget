# Checkout reservation operations

New unpaid card orders reserve stock for 15 minutes before a Stripe session is requested. Session creation durably records its intent, configured origin and a fixed 31-minute provider deadline before contacting Stripe. Retries use the same parameters and idempotency key. COD orders have no automatic reservation expiry.

## Deployment

1. Review and apply `20261028170000_checkout_reservations` through the normal migration rollout before deploying this revision. Earlier pending Stripe orders are marked `LEGACY_SESSION_UNKNOWN`; missing session IDs on these records do not prove it is safe to restock them.
2. Set `NEXT_PUBLIC_APP_URL` to the application's HTTPS origin, the Stripe key/webhook secret, a randomly generated `CHECKOUT_SWEEP_SECRET` of at least 32 characters, and `CHECKOUT_SWEEP_DATABASE` to the intended database name on the web service. The endpoint verifies `current_database()` before changing orders, preventing a mismatched deployment from sweeping another database.
3. Start a separately supervised worker with `CHECKOUT_SWEEP_ORIGIN` set to that web origin and the same secret:

```sh
node scripts/checkout-reservations-worker.mjs
```

The Docker image includes this script. Run it as a separate service/command using the same image; the web container's default command remains the web server. Supply environment through the deployment's secret manager. The worker does not read or publish local `.env` files. Alternatively, a scheduler may POST `/api/internal/checkout/expire` each minute with the bearer secret. GET and unauthenticated calls cannot trigger cleanup.

Each request selects at most 50 due orders, processes within a 20-second soft budget with bounded provider-call timeouts, and reports counts. Deferred errors/reviews get a five-minute next-check time so they do not starve newer work. Monitor worker error output, summary `errors`/`review` counts and supervisor health. A stopped/unconfigured worker is not a completed deployment.

## Safety and reconciliation

- No provider request recorded: expire and restock atomically after the persisted deadline.
- Known session: query Stripe; expire an open session before release. If payment wins the race, record the payment instead. Completed-but-unpaid sessions remain reserved pending definitive provider state.
- Unknown session after a provider request/timeout: retain inventory, set a durable review reason, retry safely while possible and let signed webhooks resolve terminal state. Never automatically restock merely because an API request failed.
- Duplicate workers, admin cancellation and webhooks lock the order and restore stock at most once.
- Late payment on a cancelled order is recorded as PAID/CANCELLED with `LATE_PAYMENT_REQUIRES_REFUND`; it is not fulfilled and does not re-decrement stock. An operator must reconcile/refund it through the provider until AUD-015's refund workflow is implemented.

Inspect unresolved records through an authorized database console:

```sql
SELECT id, "paymentStatus", status, "stripeCheckoutSessionId",
       "stripeSessionRequestedAt", "reservationExpiresAt", "reservationReviewReason"
FROM "Order"
WHERE "reservationReviewReason" IS NOT NULL
ORDER BY "updatedAt";
```

For `LEGACY_SESSION_UNKNOWN`/`SESSION_CREATION_UNCERTAIN`, find the corresponding Checkout Session in the Stripe Dashboard using the order ID metadata. Verify account, currency, total and terminal status; attach the verified session ID to that order via the authorized console. The next sweep can reconcile it. If no definitive provider record can be established, retain inventory and investigate provider request logs; do not clear markers to force a release. No automatic refund or fabricated payment success is performed by this worker.

Provider references: [session creation](https://docs.stripe.com/api/checkout/sessions/create), [session expiry](https://docs.stripe.com/api/checkout/sessions/expire), [idempotent requests](https://docs.stripe.com/api/idempotent_requests). Local SQL and test fixtures verify the application boundaries; live provider/deployment checks must use the actual configured test environment.
