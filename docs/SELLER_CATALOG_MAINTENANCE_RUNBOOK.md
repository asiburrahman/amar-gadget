# Seller catalog maintenance

AUD-031 adds owned-product content editing, separate inventory adjustments, archive/resubmission, durable receipts/history and standalone seller catalog/shipment pages. Administrator-owned products use the same owner boundary. Global administrator moderation remains separate.

## User workflow

Open `/member/products`, choose an owned product and review the saved catalog and inventory revisions. Search is literal, with exact-ID support and status filters; pages contain at most 12 records. The existing image editor remains linked from each product. `/member/orders` uses the actual per-seller fulfillment console; administrators are redirected to `/admin/orders`. Unapproved sellers cannot enter either console.

Content edits include name, description, structured specifications, category, optional brand, price and optional discount. They cannot assign another owner, set featured status, supply a slug, overwrite inventory or approve publication. Saving active/rejected content returns it to `PENDING_APPROVAL`; editing archived content keeps it `ARCHIVED`. Gallery changes follow the same publication rule. Invalid legacy specifications require explicit review/replacement instead of disappearing during an unrelated edit. Failed category/brand lookups retain the actual saved choices and show an error.

Inventory uses a signed received/removed-unit adjustment, a reason, explicit operation confirmation and both observed revisions. It preserves publication status. Checkout reservations, expired reservation returns and refunds can change inventory independently; an old stock decision fails rather than overwriting those changes. Changing the operation, quantity, reason or typed content clears its confirmation.

Archive immediately removes a product from public discovery and new checkout eligibility. It retains product records, media, existing orders and fulfillment evidence. The seller must explicitly resubmit an archived/rejected product; resubmission validates saved product fields/cover/gallery and returns it to review. An administrator cannot publish an archive directly. Existing order references also prevent hard deletion through the database relation.

Every administrator approval/rejection requires the observed `catalogVersion`; price, specifications, gallery or seller metadata changes invalidate an earlier decision. The administrator reloads the saved product before making a new decision.

## API and retry contract

`GET/POST /api/member/products` requires the current authenticated owner in `X-Product-Owner`, verified current role/session and approved seller status. The server derives ownership and locks current authority before mutations. Responses are private/no-store. Reads, writes, decoded JSON size (192 KiB), identifiers, metadata, quantities and reasons are bounded. Duplicate/unknown query fields and injected mutation fields are rejected. Public category/brand choices never authorize a write.

Each write carries a UUID `requestId`, reason and observed catalog revision. Stock also carries `inventoryVersion` and an explicit confirmation. Exact repeated intents return their durable original result and the current owned row. Reusing the UUID for different fields fails. A response lost after commit never justifies a new UUID: reload using `requestId` first, then retry the identical intent only if no receipt exists. The editor keeps typed fields during this process. Reloading a list never silently rebases an open draft; loading the current product revision explicitly replaces fields. A product subsequently deleted/transferred can still have a valid original receipt without exposing its new owner's current record.

`mode=record&id=...` reads one owned record; `mode=history&id=...` reads 20 captured-owner events per page. List filters do not hide the requested original receipt. The client aborts outstanding requests and removes private state when its current account changes. Errors do not claim a successful mutation.

## Schema and purchase retention

Reviewed migration: `20261102130000_seller_catalog_maintenance` (migration 27). Readiness requires this migration. Apply only after the usual backup, review and approved deployment procedure; this task does not apply production migrations.

PostgreSQL maintains `catalogVersion` for actual catalog changes and `inventoryVersion` for actual stock changes, including writes from other workflows. Review aggregates do not invalidate content drafts. Setting a counter manually does not manufacture a new revision. Changes record compact append-only `ProductMaintenanceEvent` evidence; idempotency uses append-only `ProductMaintenanceRequest` records. Nullable workflow actor/reason means an automatic stock writer did not supply an interactive actor; it is never labelled as the seller making that change.

New order items capture product name/slug in PostgreSQL with `PURCHASE` provenance, ignoring caller-supplied labels. Labels are immutable. Migration backfill copies the label currently displayed for older purchases and explicitly marks it `LEGACY_CURRENT`; it does not reconstruct missing original purchase text. Customer order lists/details/confirmation, administrator order views, fulfillment/refund views and recent customer dashboard orders use captured names. Product review/catalog views continue to use current catalog names. Existing order-item prices and financial/fulfillment snapshots remain authoritative.

Owner mutations use `FOR NO KEY UPDATE` while stock/catalog rows are updated under product locks. This still serializes credential/account changes and media cleanup, while allowing a checkout already holding a product row to finish seller foreign-key `KEY SHARE` checks. A PostgreSQL concurrency regression exercises that exact lock sequence and requires the stale stock decision to fail after checkout commits.

## Verification

Use a disposable local `audit_*` database for integration and prepared-artifact smokes:

```powershell
npx prisma migrate deploy
npx prisma generate
npx jest --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:product-maintenance
```

`TEST_DATABASE_URL`, `DATABASE_URL` and `DIRECT_URL` must refer to the intended isolated local fixture for these commands. The native smoke creates and migrates its own randomly named database, uses real login cookies, signed ingress, compiled Next Server Actions and HTTP APIs, then removes only that newly created database. Local Redis and signed-S3 fixtures are test infrastructure; no application fake-success/provider fallback is introduced. Gallery transport/decoding and archive behavior also have PostgreSQL plus signed-S3 HTTP regression coverage.

Final run results belong in `CODEX_IMPLEMENTATION_LOG.md`. Interactive-browser and actual hosted-provider certification remain AUD-044; production migration/deployment and external money/email operations are not certified by a local smoke.
