# Category hierarchy and brand administration

AUD-027, 2 November 2026. Work branch: `codex/deep-audit-2026-10-28`. This task connects administrator forms, database constraints, real image storage and current storefront browsing. It does not replace the separately scheduled coupon, banner, seller-product-maintenance or release tasks.

## Administrator operation

`/admin/categories` and `/admin/brands` now use the same authenticated catalog service. Lists, searches, parent choices and retained history have exact counts and bounded pages of twenty records. Names/slugs, direct product references, child counts and saved revisions are visible. Queries use current verified administrator/session authority and an expected-owner header; customer/seller accounts cannot use these handlers.

Create the record's name/slug first, then upload and publish an optional category image or brand logo. Existing records support metadata changes, parent reassignment, image replacement/removal and explicit deletion. Each change requires a request UUID; edits/deletion/image publication also require the observed revision. A successful save reloads the actual saved record, including its canonical normalized fields and current image. A late saved-record read cannot overwrite a different selected draft.

The parent picker searches full ancestry labels, excludes the edited category and all descendants, and preserves an existing selected parent across choice pages. A category may have products of its own and subcategories. Brands have no parent field. Category names are unique among siblings, so `Phones / Accessories` and `Laptops / Accessories` are valid separate records. Root category names and brand names are unique case-insensitively. New names are bounded, normalized plain text; slugs use unique lowercase letters/digits/hyphens.

Deletion requires the administrator's explicit revision-bound checkbox. Any referenced product, including unpublished or archived products, prevents category/brand deletion. Children also prevent parent deletion. Restrictive foreign keys protect concurrent inserts and direct SQL from silently removing a referenced brand. Move/retain those references rather than bypassing the guard. Retained event/request evidence survives deletion of an otherwise unused record.

## Retry, authority and audit

Every mutation stores an immutable UUID, normalized request hash, administrator identity and committed result in the same transaction as its catalog change. Replaying the exact original intent returns its receipt without repeating the change, even if its original image has since been detached. Reusing the UUID with different content is rejected. A private receipt query is scoped to the same administrator and catalog kind.

An uncertain browser write preserves the typed draft and original request. Reload checks that receipt before permitting the original intent to be retried or discarded. Stale edits never silently adopt a newer revision. Account/role changes abort and hide the old administrator's data; a late image-upload response cannot publish under another account. Current database authority is rechecked after storage verification and again under publication locks.

Metadata, hierarchy and aliases share a transaction-level advisory lock; row/account locks and current revisions serialize competing edits. Parent cycles are rejected by both the service and SQL. SQL triggers retain actual CREATE/UPDATE/DELETE snapshots, actor identity and UTC timestamps. System/import/seed writes have a truthful empty actor rather than a fabricated administrator. History is paginated and can still be queried for deleted record identities. Request receipts and history reject UPDATE/DELETE operations.

## Slugs and storefront hierarchy

Renaming a slug retains an alias to the same catalog identity while it exists. Case-folded live/alias uniqueness prevents another record from claiming that earlier URL. Restoring an earlier slug is supported. Category retained-URL redirects use 307 (or Next's streaming redirect instruction) so restoring A after A-to-B does not create cached permanent redirect loops. Ordinary canonical ID/case redirects keep their existing behavior. Metadata and sitemaps use the current canonical URL; brand query aliases resolve the current brand identity.

Selecting a parent category in the catalog includes its descendants while retaining the existing public approval/seller-visibility, brand, price, search and sort intersections. Hierarchy paths distinguish similarly named subcategories in administrator choices, seller product submission and public filter options. Parent collections with approved descendant products are included in category sitemaps.

The category showcase derives descendant selection from each node's direct product list, avoiding duplicated ancestor product datasets. An empty category shows its own empty state rather than borrowing unrelated products as a featured item. Category images appear from verified current catalog data. The public category directory reports a real query failure separately from an empty catalog.

Homepage category shortcuts use current root categories. Desktop/mobile department menus fetch current root categories on opening, with explicit loading/error/reload behavior and a link to the complete directory beyond their ten-root preview. They do not substitute seeded category names on failure. Stable footer browse links avoid stale hardcoded category destinations. Promo/banner content remains the separately scheduled AUD-029 work.

## Image storage and cleanup

The forms reuse the actual authenticated `/api/upload` preparation and create-only presigned R2 PUT pipeline. Images remain under the immutable uploader-owned `products/<administrator-id>/<uuid>.<extension>` media namespace, shared deliberately with the existing verified catalog-media lifecycle. A taxonomy mutation accepts an owned upload key or explicit removal, never an arbitrary supplied image URL or inline bytes.

The server verifies stored length/type/signature and completely decodes a single JPEG/PNG/WebP raster under the existing 5 MiB, 16-megapixel and dimension/frame bounds. Publication rechecks the object's ETag/length/type after acquiring the same owner lock used by cleanup. Provider calls use only the configured R2 account and public HTTPS media origin. An unavailable/changed/foreign object cannot be published.

Category and brand image references now participate in the shared live-key guard alongside product galleries. Avatar cleanup also recognizes manually imported live taxonomy aliases. Replacing, removing or deleting a managed image queues the existing durable cleanup job after the retention period; legacy unmanaged external URLs are not deleted. A category/brand can share an already verified owned image. Cleanup retains it while either current reference exists, across current/historical CDN origins, and deletes it only after all references are detached and the object is old enough. Abandoned uploads remain covered by the existing paginated orphan scan.

No separate bucket, provider-host override, fake upload or new cleanup secret is introduced. Continue supervising `npm run worker:media-cleanup` with its existing independent maintenance Bearer key, scoped trusted-ingress signature and exact expected database target. See [product-media lifecycle operation](PRODUCT_IMAGES_RUNBOOK.md) and existing R2 CORS/upload instructions. Local signed fixtures are distinct from hosted R2/browser certification.

## Schema upgrade and seed behavior

Migration `20261102090000_catalog_taxonomy` is migration 23 and is now required by readiness. It adds parent/revision fields, sibling/case-fold uniqueness, restrictive brand relationships, retained aliases and immutable event/request records. Legacy categories/brands/products/images are preserved; existing root categories remain roots. Case-fold collisions fail the migration transaction for operator review rather than silently merging identities or moving products. Back up and review a production rollout separately; this work has migrated only isolated local databases.

The actual reference seed now checks both current and retained seed slugs under the same catalog lock. It creates missing reference entries without undoing administrator names/slugs or creating duplicate identities after a rename. Re-running it creates no accounts or products and does not publish login credentials. Failures log a generic configuration/migration/uniqueness message without credential/query details.

## Local verification

Use only a disposable local PostgreSQL `audit_*` database with both Prisma URLs pointing to it:

```powershell
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:DIRECT_URL = $env:DATABASE_URL
npx prisma migrate deploy
npx prisma generate
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npx prisma migrate status
node --check prisma/seeds/seed.js
npm run build
npm run smoke:taxonomy
npm run smoke:dashboard-metrics
git diff --check
```

Migration rehearsal uses a newly created local database with legacy data and tests preservation, cycle/revision/alias guards, case-fold collision rollback, restrictive deletion, immutable evidence and Dhaka-session UTC events. Financial/catalog integration suites create their own fresh databases because retained evidence is intentionally not ordinary row-cleanup data. Only the database created by that invocation is dropped.

Actual PostgreSQL plus signed S3 HTTP cases exercise exact intent recovery, concurrent observed revisions, sibling names, cycles, unpublished-product protection, verified shared image publication/cleanup, authority revoked during verification, changed/foreign objects, original receipt recovery after object deletion, bounded parent/list searches, strict private handlers/rates, descendant public listing intersections and retained URLs. The real Node seed CLI is executed twice around administrator renames to prove that operator changes and account/product counts are preserved. DOM cases exercise real forms, parent selection, image upload/publication contracts, deletion affirmation, lost responses/receipt lookup/exact retry, StrictMode, account-switch aborts, descendant/empty selection and current department navigation.

The compiled-server smoke performs actual password login, category/child/brand CRUD, original-intent retry, actual signed presigned upload, real SDK verification, public CDN byte equality, descendant public queries, retained-URL redirect, current hierarchy sitemap/directory, linked-reference/owner/role/Origin guards, dual-auth shared-object cleanup and retained delete history. The first runner assertion expected an HTTP 307 before streaming; installed Next can emit its documented redirect instruction after headers start, and the final smoke checks both valid protocol outcomes. The original full-suite SEO fixture also needed to supply the newly required revision and clean up by its own captured user IDs rather than mutable slugs; the guard was preserved. Earlier failed fixtures were retained and final verification used a new local database.

Recorded final checkpoint: **795 tests across 88 Jest suites passed** with isolated PostgreSQL enabled. TypeScript, Prisma validation, all 23 migration status checks, final production build, seed syntax/actual CLI and diff checks passed. Changed-file ESLint has zero errors and six existing native-image warnings. Final compiled taxonomy and dashboard-metrics smokes passed; targeted product-image, avatar, brand/listing and SEO regressions also passed.

Hosted R2 configuration, actual browser walkthrough, production migration/deployment, the other original audit tasks and external SMTP credential revocation remain outstanding release/operator work. No real external upload, payment or email operation was performed by these local fixtures.
