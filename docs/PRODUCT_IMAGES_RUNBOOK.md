# Product images: direct R2 uploads, gallery and unused-object cleanup

AUD-016 wires the seller add-product form to real direct uploads. Select one to eight JPEG/PNG/WebP files of at most 5 MiB each. Local previews use revocable blob URLs. The picker shows upload progress, failure/retry, cancellation/removal and cover selection. Submit stays disabled until every selected image has uploaded. Retrying requests a fresh five-minute upload URL; a failed storage request is never presented as success.

## Request and persistence path

The authenticated, approved seller requests `/api/upload` with MIME and byte length only. Independent IP/account budgets limit preparation to forty requests per minute. The server generates a UUID key beneath that account's `products/` prefix. The file bytes travel directly to the configured account's R2 S3 endpoint in a PUT, with no session cookies sent to storage. Neither FileReader/base64 content nor an inline file is sent to a Server Action. Content type, content length, cache policy and `If-None-Match: *` are signed. The conditional write prevents a successful upload URL from replacing an already stored object. The SDK's optional empty-body checksum generation is disabled for these body-less presigns; the signed length/type and subsequent object verification remain mandatory.

The create action accepts the ordered keys, rejects caller-supplied image URLs/inline data, and resolves URLs itself. Before its transaction commits, the server rechecks current verification/session/role/seller approval and verifies every account-owned key against R2 HEAD plus a bounded first-byte GET with matching ETag. Missing, oversized, mismatched-MIME, duplicate, foreign-account and invalid raster-signature objects cannot produce a product row. Verification does not trust the client's upload-success event. First-byte format checks are not full image decoding, malware scanning or moderation. General product price/description/status/direct-payload validation remains the next separate task, AUD-017.

Verification and publication hold the owner row lock under a fifteen-second transaction bound; each storage read has a five-second abort limit and at most two SDK attempts. The cleanup operator takes the same lock, preventing deletion between validation and publication. A storage/SQL failure returns a retryable failure without creating an image-less product or leaking provider exceptions. Creation returns serializable ID/slug data rather than Prisma Decimal objects. The product remains pending administrator approval.

The product page displays the saved ordered gallery with accessible thumbnail controls. The first selected image is the cover. Existing configured Unsplash/R2 public hosts retain Next image optimization. Runtime-only custom R2 CDN domains use direct delivery in gallery/cards; no wildcard image proxy or private S3 endpoint is introduced. Configure CDN resizing/derivatives separately if needed; custom-domain direct delivery does not create responsive resized files. Existing records and their images are not rewritten by this change.

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

The integration suite uses actual AWS SDK signing, independent SigV4 verification over local HTTP, a generated valid 1024×1024 RGB PNG exceeding 3 MiB, and actual PostgreSQL writes/locks. It exercises upload preparation, PUT, HEAD/ranged GET, gallery persistence, altered signed headers, create-only overwrite denial, invalid/foreign/missing images, current seller revocation, storage failure, dry-run/applied DELETE, preservation across CDN changes and both cleanup/publication race winners. Test-only provider credentials/objects are confined to the fixture; application code has no fake storage fallback or configurable test endpoint.

DOM tests exercise the actual upload helper/picker/form/gallery with mocked fetch/XHR boundaries: bytes sent directly, metadata-only app requests, progress, ready gating, cover order, retry, cancellation/reselection, unmount cleanup, invalid selections, network/timeout handling and thumbnail selection. These do not prove browser CORS against a real R2 bucket. The production artifact smoke separately verifies catalog/product server rendering, packaged assets, signed login and readiness/revocation.

Before releasing, configure an isolated test bucket/domain and its CORS, then use the real browser on the canonical test deployment to upload 2–5 MiB raster files, submit, approve and reopen the saved gallery. Test a failed upload/retry and review a cleanup dry-run before scheduling deletion. Live bucket permissions/CORS/CDN, browser/provider verification and deployment remain AUD-044 release gates. No production bucket, database, credential or deployment was changed during these local checks.
