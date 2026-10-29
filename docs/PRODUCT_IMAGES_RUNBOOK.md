# Product images: direct R2 uploads, gallery and unused-object cleanup

AUD-016 wires the seller add-product form to real direct uploads; AUD-017 adds bounded full decoding and shared product/mutation validation. Select one to eight single-frame JPEG/PNG/WebP files of at most 5 MiB and 16 megapixels each, with no side above 8192 pixels. Local previews use revocable blob URLs. The picker shows upload progress, failure/retry, cancellation/removal and cover selection. Submit stays disabled until every selected image has uploaded. Retrying requests a fresh five-minute upload URL; a failed storage request is never presented as success.

## Request and persistence path

The authenticated, approved seller requests `/api/upload` with MIME and byte length only. Independent IP/account budgets limit preparation to forty requests per minute. The server generates a UUID key beneath that account's `products/` prefix. The file bytes travel directly to the configured account's R2 S3 endpoint in a PUT, with no session cookies sent to storage. Neither FileReader/base64 content nor an inline file is sent to a Server Action. Content type, content length, cache policy and `If-None-Match: *` are signed. The conditional write prevents a successful upload URL from replacing an already stored object. The SDK's optional empty-body checksum generation is disabled for these body-less presigns; the signed length/type and subsequent object verification remain mandatory.

The create action accepts ordered keys, rejects caller-supplied image URLs/inline data and resolves URLs itself. R2 HEAD plus a bounded full GET with matching ETag checks every account-owned object. Sharp verifies the declared raster format, dimensions/channels and frame count, then decodes pixels with `stats()`; metadata alone does not certify a complete file. Truncated, disguised, excessive-dimension, foreign, duplicate, missing and incomplete objects cannot produce a product row. This is raster validation, not malware scanning or product moderation. No user URL is fetched as an arbitrary server-side image source.

Full verification occurs before opening the database transaction. One file is buffered/decoded at a time per batch; at most two verification batches run concurrently in the Node runtime, with immediate busy rejection rather than an accumulating queue. Provider reads have five-second aborts and a twenty-second batch deadline; a native decode has its own five-second timeout and the batch deadline is checked afterward. These bounds are not an end-to-end latency SLA. Independent IP/account creation budgets allow ten attempts per minute. The R2 client is reused within the process.

Publication then takes the owner row lock under a fifteen-second transaction bound, rechecks current verification/session/role/seller approval and performs conditional HEAD checks against the verified ETags/lengths/types before inserting. The cleanup operator takes that same lock, so a validated object deleted before publication causes failure rather than a broken row. Expensive pixel decoding does not hold the account lock. Storage/SQL failure does not substitute an image or leak provider exceptions. Creation returns serializable ID/slug data rather than Prisma Decimal objects, and both create entry points require pending administrator approval.

The product page displays the saved ordered gallery with accessible thumbnail controls. The first selected image is the cover. Existing configured Unsplash/R2 public hosts retain Next image optimization. Runtime-only custom R2 CDN domains use direct delivery in gallery/cards; no wildcard image proxy or private S3 endpoint is introduced. Configure CDN resizing/derivatives separately if needed; custom-domain direct delivery does not create responsive resized files. Existing records and their images are not rewritten by this change.

## Product and administrator validation

The shared strict schema bounds names to 3–120 trimmed characters and descriptions to 20,000 characters. Prices must be finite numeric values from 0.01 through 99,999,999.99 BDT, at most two decimals, matching DECIMAL(10,2). Discounts must be positive and strictly below regular price; null clears a discount. Stock must be a whole number from zero through PostgreSQL's 2,147,483,647 integer maximum. IDs and keys are bounded, galleries contain at most eight distinct references, and category/brand records must exist. Unknown ownership/status/rating fields are rejected. Sellers cannot assign the featured flag. The form uses Number rather than truncating fractional stock with parseInt, and shares the server's validation rules.

Admin product status, price, delete and seller status mutations validate actual runtime arguments. Current administrator verification, role and session version are rechecked under its user-row lock; a stale cookie cannot retain mutation authority. The seller HTTP endpoint delegates to the same guarded action and bounds JSON input. Product approval validates the current persisted fields/media and approved, verified seller. Local image paths must resolve to actual public assets. Legacy external HTTPS image URLs are validated for bounded safe syntax, not fetched from arbitrary hosts; they are not retroactively certified as newly decoded R2 objects. Existing invalid records can be rejected/pended; no legacy price/media is silently rewritten, and production data/migration review remains AUD-047/049.

Admin controls retain the form and show returned failures, including foreign-key protected deletion. Success is shown only after a successful mutation. Prices returned to React are numbers, not Prisma Decimal instances. Full administrative catalog editing and its other remaining features are separate audit tasks.

Sharp 0.35.5 is an explicit pinned runtime dependency, rather than an incidental optional dependency of Next. Installed Next output-tracing guidance is followed to include the installed Sharp platform DLL/shared-library assets. The initial Windows standalone smoke found missing DLLs (`ERR_DLOPEN_FAILED`); explicit narrow tracing resolved the actual create-action 500. Rebuild on the target deployment platform. Linux/Docker execution is not established by the Windows native test.

## Storage configuration and CORS

Set the R2 account, bucket, access key and secret through private runtime configuration. `R2_PUBLIC_URL` must be the bucket's public HTTPS origin, without credentials, path, query or fragment. A public custom domain is appropriate; an S3 API endpoint or a presigned query string is not a public base. Ensure the domain serves that exact bucket. Use credentials scoped to the intended bucket; upload/verification need object write/read, and the operator additionally needs list/delete. Startup checks syntax, not actual provider permissions.

Generate the Cloudflare dashboard CORS policy from the exact configured `APP_URL`:

```sh
npm run config:r2-cors
```

Copy the printed JSON array to that bucket's CORS Policy JSON editor and save it. This command only prints policy; it does not change Cloudflare. It permits the configured origin and the PUT/GET/HEAD operations, with Content-Type, Content-Length, If-None-Match and Cache-Control headers. It exposes ETag. Do not replace the origin with a wildcard. Browser uploads require bucket CORS in addition to a valid presign. Presigned writes use the account S3 API hostname; public URLs use `R2_PUBLIC_URL`. See [Cloudflare presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/) and [conditional writes](https://developers.cloudflare.com/r2/api/s3/api/).

Deploy behind the [trusted gateway](TRUSTED_INGRESS_RUNBOOK.md). Its Origin policy protects preparation/actions; the R2 bucket's CORS independently governs the direct browser-to-storage hop. No server-action body-limit increase is required: a two-image create payload in the real integration test is below 2 KiB even though each PNG exceeds 3 MiB.

## Removed, abandoned and failed uploads

Removing a picker item removes it from that submission and revokes its local preview. It does not immediately delete the remote object: the same account may have used it in another product. A failed or abandoned creation can therefore leave an unreferenced object. The operator tool reclaims such objects after a minimum age of twenty-four hours, well beyond the five-minute presign and upload timeout.

Run maintenance from the checked-out source in an operator environment with the development CLI dependencies installed. The standalone web container does not execute TypeScript maintenance CLIs. Set `MEDIA_CLEANUP_DATABASE` explicitly to the intended database name and provide that database plus the matching bucket's private configuration. The tool checks `current_database()` before any storage operation.

```sh
# Dry run: count candidates, retain all objects.
npm run cleanup:product-images

# Operator-authorized deletion of old, unused images only.
npm run cleanup:product-images -- --apply
```

Each call processes at most one hundred keys. If a `cursor` is returned, pass it through `--cursor=` for the next page until absent. A scheduled operator job must persist/follow this cursor; repeatedly scanning just the first page can starve later keys. Review the dry-run counts before enabling a scheduled apply job. Monitor nonzero `errors`/exit status and retry failed pages. No such production job is deployed by this commit.

The tool ignores other storage prefixes and refuses malformed account/object keys. It rechecks every cover/gallery reference under the owner lock and matches the immutable key across old and current CDN domains. A CDN-origin change cannot make a referenced image eligible for deletion. Fresh objects and referenced images remain. If cleanup wins a race against creation, subsequent verification fails rather than publishing a deleted image; if creation wins, cleanup sees the reference and retains it. A storage deletion timeout is an error, not a successful count. There is no bucket-wide recursive delete or age-only lifecycle rule that could remove live product images.

## Evidence and release checks

The integration suite uses actual AWS SDK signing, independent SigV4 verification over local HTTP, a generated valid 1024×1024 RGB PNG exceeding 3 MiB, native Sharp and actual PostgreSQL writes/locks. It exercises upload preparation, PUT, HEAD/full GET, decoded PNG/JPEG/WebP, gallery persistence, altered signed headers, create-only overwrite denial, truncated/disguised/over-limit images, invalid/foreign/missing references, current seller revocation, storage failure, dry-run/applied DELETE, preservation across CDN changes and both cleanup/publication race winners. It also checks the ETag again at publication and proves the two-batch workload limit. Test-only provider credentials/objects are confined to the fixture; application code has no fake storage fallback or configurable test endpoint.

DOM tests exercise the actual upload helper/picker/form/gallery and admin controls with mocked fetch/XHR/action boundaries: direct file bytes, metadata-only app requests, progress, ready gating, cover order, retry, cancellation/reselection, unmount cleanup, invalid stock/discount/selections, network/timeout handling, gallery selection and truthful mutation feedback. These do not prove browser CORS against a real R2 bucket. The production artifact smoke separately verifies catalog/gallery server rendering, packaged assets, signed login and readiness/revocation. `npm run smoke:catalog-actions` uses the actual built Next action references/Flight transport, real administrator login and SQL to verify malformed-request rejection, price-result serialization, exact writes, approval and copied-cookie revocation. It never publishes the manifest's encryption key or private child logs.

Before releasing, configure an isolated test bucket/domain and its CORS, then use the real browser on the canonical test deployment to upload 2–5 MiB raster files, submit, approve and reopen the saved gallery. Test a failed upload/retry and review a cleanup dry-run before scheduling deletion. Live bucket permissions/CORS/CDN, browser/provider verification and deployment remain AUD-044 release gates. No production bucket, database, credential or deployment was changed during these local checks.

Decoder references: [Sharp input safety options](https://sharp.pixelplumbing.com/api-constructor/), [metadata versus decoded pixel statistics](https://sharp.pixelplumbing.com/api-input/). No screenshots, live-provider outcomes or production traffic metrics are invented by these tests.
