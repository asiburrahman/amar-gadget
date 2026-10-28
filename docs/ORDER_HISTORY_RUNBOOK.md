# Order history and shipment tracking

Apply `20261028190000_order_event_history` through the normal reviewed rollout before deploying this revision. It requires the previous five migrations. Fresh-install and five-migration upgrade rehearsals passed on isolated PostgreSQL 18 databases. No production rollout is performed by the implementation commit.

The migration adds carrier/parcel columns and creates `OrderEvent`. Existing creation timestamps are retained as `ORDER_PLACED` events. Their state at migration is captured as `LEGACY_SNAPSHOT` with a **null occurredAt**, because earlier transition times cannot be reconstructed. `recordedAt` identifies when the snapshot was recorded, not when the historical transition happened. Do not fill unknown shipment/cancellation times with creation or last-update timestamps.

New order inserts and actual status, payment or carrier/parcel changes automatically produce events in the same transaction through `Order_record_event`. Application code must update the order; it must not manually duplicate those events. Failed transactions roll back history too. Reservation marker/session-ID-only writes and no-op updates produce no event. The indexed database sequence gives a stable order for simultaneous timestamps.

The admin orders screen can save real carrier and shipment tracking numbers on processing/shipped orders. Card payments must be paid; COD retains its existing eligibility. The store's `AG-...` tracking code remains distinct from the carrier's parcel number. Mixed-seller fulfillment is still AUD-014 and is not represented as implemented here.

Public tracking still requires the checkout phone number plus order ID/store tracking code. It exposes no address, phone or capability and pages immutable events 50 at a time with an order-scoped cursor. It is an explicit status lookup, not push delivery tracking or a carrier API integration. The customer can submit again for current state, or load additional recorded history. A future carrier integration must append real changes through the same order/fulfillment contract.

`OrderEvent_immutable` prevents updates and individual deletes while the parent order exists. Deleting the parent retains the repository's existing foreign-key cascade policy, including removal of its events; this is not an independent financial retention policy. Ordinary application routes do not delete these history records. Retention/deletion permissions are reviewed under AUD-049. Privileged database owners can change triggers, as with any schema protection; restrict migration/admin credentials in deployment.

Before release, rehearse the migration with a representative disposable copy, measure the backfill/lock duration, and verify event counts plus unknown legacy dates. Deploy the migration before application code. Removing/reversing the migration would remove history and requires a separate reviewed recovery plan; do not edit historical events to repair a display problem.

Local validation:

```powershell
$env:DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/audit_history'
$env:DIRECT_URL = $env:DATABASE_URL
npx prisma migrate deploy
npx prisma generate
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm test -- --runInBand
```

Use only a disposable local `audit_*` database. The integration suite rejects external hosts/database names and removes only its own fixture records. Browser/carrier/hosted Stripe checks remain release verification and are not inferred from the SQL/DOM tests.
