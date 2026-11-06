# Homepage banners (AUD-029)

Administrator page: `/admin/banners`. Private API: `GET/POST /api/admin/banners`. Public homepage data is queried on the server from saved active `Banner` records. Hero, promo and announcement placements no longer depend on hardcoded sample offers, category slugs or an unsupported dollar-price/warranty claim.

## Publish and maintain a banner

1. Create a banner with a title, optional subtitle/link, placement, position and a real uploaded JPEG/PNG/WebP. New console drafts start inactive. Images use the existing signed R2 upload path: at most 5 MiB, single-frame, at most 16 megapixels and 8192 pixels per side. Uploading alone does not publish a banner; the server verifies object ownership, decoded bytes and the unchanged stored object before committing.
2. Choose HERO for the featured carousel, PROMO for the promotion grid, or AD for announcements below the catalog sections. Lower nonnegative positions appear first; equal positions use stable IDs. Each placement supports 24 active banners. Additional records can remain inactive and appear through administrator pagination.
3. Activate the saved revision when ready. The next homepage request uses saved data. Hero previous/next/direct-selection buttons work without automatic motion. Announcements without links are informational rather than pretending to be clickable.
4. Edit details/order/placement or replace the image using the observed revision. A replacement is a separate explicit operation; selecting a file does not silently alter an existing image when saving text. Deactivate to remove the banner from public queries. Explicitly confirm the selected revision before deletion.

Links are optional public storefront paths beginning with a single slash, including safe query strings/fragments. Schemes, protocol-relative URLs, backslashes/control characters, malformed encodings and protected/API destinations are rejected. Use an encoded path such as `/products?search=usb%20c`. Public rendering also checks imported legacy URLs; invalid active data produces an unavailable state rather than unsafe navigation or invented fallback success.

The generic catalog navigation/featured-product fallback appears only when the corresponding placement has no active banners. A failed banner query shows explicit unavailable states. Saved title/subtitle and image are used directly with React text escaping. No banner in one placement suppresses another placement's independent empty state. The carousel loads its selected image eagerly and later selections on demand; there are no decorative nonfunctional slider dots.

## Revision, receipt and image lifecycle

Every write carries a random request UUID. Updates, image changes, activation and deletion also carry the observed version. Current verified ADMIN authority and session version are rechecked under a database account lock; writes serialize against other banner edits. IP/account limits, strict queries, bounded JSON and `X-Banner-Owner` bind requests to the administrator who opened the console. Private responses use `private, no-store` and do not expose storage credentials.

Exact retries return the original durable receipt plus the current saved state. A recorded create/edit remains recoverable if another administrator subsequently deletes its banner. Before/after history records actor, monotonic sequence and UTC instant; receipts/events cannot be rewritten or deleted. History remains available by banner ID after deletion. A receipt cannot be reused by another owner or with another body.

The console preserves typed fields after failures and list reloads. After an unconfirmed write, reload its original receipt before retrying the identical UUID/body or discarding unrecorded intent. Retrying an image-publication request reuses its original uploaded key rather than uploading another object. Explicit revision reload replaces fields; account changes abort upload/API work and ignore late completions. Upload failures do not report saved success.

Replacement/deletion queues old managed images for the existing retained cleanup process. Product/category/brand/banner references are checked together, including inactive banners and prior CDN origins. A shared image is retained until its last live reference is removed. Avatar cleanup also recognizes imported banner references. Failed or abandoned uploads remain eligible for the existing orphan sweep; no provider deletion occurs in an administrator request.

## Migration and rollout

Migration `20261102110000_homepage_banners` adds placement/position/revision, UTC update timestamps, listing index, append-only request/history tables and revision/bounds guards. Readiness requires all 25 migrations. Existing title/subtitle/image/link/active/creation values are preserved; legacy records enter HERO at position zero. Existing unspecified order is made deterministic by ID.

Before production rollout, back up the target database and review legacy titles (1–160 nonblank characters), subtitle lengths (at most 500), image/link validity and active counts. Incompatible bounds cause the transactional migration to roll back without truncating content. Unsafe imported URLs or excessive active counts require operator review before public display; data is never silently rewritten, discarded or relabelled inactive. Existing historical edits cannot be reconstructed: new evidence starts with subsequent operations. Do not edit an applied migration.

No production migration, hosted upload, deployment or interactive-browser certification is performed by this implementation. Actual configured R2 permissions/CORS/CDN and browser release checks remain part of AUD-044.

## Local verification

Use only a disposable local PostgreSQL `audit_*` database; point `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL` to it.

```powershell
npx prisma migrate deploy
npx prisma generate
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npx prisma migrate status
npm run build
npm run smoke:banners
npm run smoke:taxonomy
npm run smoke:coupons
git diff --check
```

Database/migration and native financial fixtures create fresh random local databases and drop only the database they created. Existing databases and failed fixtures are not reset. PostgreSQL/S3 cases use actual SQL and signed SDK/HTTP requests against an isolated provider fixture, including decoded image bytes, revision races, authority revoked during verification, receipt recovery after deletion, active capacity, literal searches, unsafe imports, retained evidence and shared-image cleanup. DOM tests explicitly replace HTTP/upload boundaries and test real forms, retries, deletion intent, account-switch cancellation, live carousel controls and fallback/error rendering; they are distinct from hosted-provider or interactive-browser evidence.

Recorded checkpoint: **852 tests across 96 Jest suites pass** with isolated PostgreSQL enabled; the final targeted banner run passes 32 cases. TypeScript, all changed-file ESLint, Prisma validation, all 25 migration status checks, production build, runner syntax and diff checks pass. The compiled banner smoke passes actual password login, signed upload/SDK verification/CDN bytes, saved placements and visible homepage changes, activation/order/edit/delete/fallback behavior, unsafe/stale/owner/role/Origin/revocation guards, retained receipts/history and shared-object cleanup through the actual maintenance endpoint. Existing compiled taxonomy/media and coupon/cart/checkout regression smokes also pass.
