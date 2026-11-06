# Owned profile photos — AUD-038

## Account behavior

Profile photos use the server upload endpoint and the application's configured R2 bucket/public media origin. The browser sends the selected original JPEG, PNG or WebP file; it never assigns its own object key or a remote image URL. The server verifies the signature and fully decodes the raster, rejects unsupported/animated/corrupt images and excessive dimensions, rotates orientation, fits within 512-pixel bounds and writes metadata-free WebP under a new immutable `avatars/<account-id>/<uuid>.webp` key. Images up to 5 MiB, 16 million decoded pixels and 8192 pixels per side are accepted. Smaller images are not enlarged.

Both profile photo controls use the same editor. The editor publishes the returned saved URL only after storage and SQL succeed. It keeps an unsuccessful selection as an explicitly unsaved local preview, prevents duplicate in-flight changes and requires reloading the saved photo before retrying an uncertain/stale change. Reloading the photo does not reset typed name, phone or address fields. Replacing/clearing a photo requires the observed `avatarVersion`; another session's winning update cannot be silently overwritten. Account-keyed views, expected-owner headers, request cancellation and callback guards prevent a previous account's response from entering a new account's form/cache. Auth/profile DTOs omit storage keys and historical source values; old cached inline or unrelated remote avatars are discarded.

Optional signup photos remain supported. One email-bound File is held in memory for up to fifteen minutes through client navigation to OTP verification. Anonymous registration receives no image. After successful verification establishes the session cookie, the photo uploads under the verified account. A photo failure does not undo successful verification: retry first reloads the actual saved revision, or the owner can continue and upload from their profile. Reloading/closing the tab loses the in-memory selection; the signup page explains this. Files, passwords and inline photos are not persisted for this handoff.

## API contract

All `/api/user/upload-avatar` operations require a current verified session and `X-Avatar-Owner` matching that session. Responses have `Cache-Control: private, no-store`. Production requests also pass the shared ingress signature and browser Origin policy.

| Method | Input | Result |
| --- | --- | --- |
| GET | Expected-owner header | `photo: {ownerId, avatar, avatarVersion, legacyAvatarAvailable}` |
| POST | Multipart `file` and decimal `avatarVersion`, each exactly once | Normalize, upload and publish an owned object |
| POST | JSON `{avatar: "data:image/png;base64,...", avatarVersion}`; JPEG/WebP also supported | Same complete validation/storage pipeline |
| POST | JSON `{action: "restore-legacy", avatarVersion}` | Restore supported historical inline raster through that pipeline |
| DELETE | JSON `{avatarVersion}` | Atomically clear the saved reference and any private historical backup |

The profile PUT accepts a photo field only with its revision and `X-Avatar-Owner`. It may retain the exact observed current managed URL or clear with null/empty string. It cannot assign a new URL or inline payload. Combined name/address/photo changes and cleanup jobs commit or roll back together. Ordinary profile forms omit photo fields so an unrelated name save cannot overwrite a newer image. Registration rejects nonempty avatar fields; optional file upload happens after verification.

Invalid fields/media/revisions return 400; missing session 401; oversized bodies/files 413; unsupported request Content-Type 415; conflicting account/photo state 409; stalled body 408; exhausted rate budgets 429 with Retry-After; busy decode slots or unavailable storage/database 503. An upload has a fifteen-second absolute input deadline, a bounded streamed body before multipart/JSON allocation, two process-local decode/upload slots with no waiting queue, and separate distributed IP/account limits. Limits also apply when Content-Length is absent or false. Provider failures never expose their raw exception, credentials or payloads.

## Migration and publication

Review/apply `20261030120000_owned_avatars` as a coordinated schema/application release after backing up the intended database. Readiness requires this migration. It moves every nonempty historical User.avatar value into the separate private `UserAvatarLegacy` table, clears User.avatar and adds owned key/version columns and database constraints. It preserves unsupported remote or malformed values privately rather than automatically fetching or publishing them. Owners can restore a supported bounded inline raster, upload a new file, or explicitly remove the old copy. Successful publication consumes the historical copy atomically; failure preserves it. No previous database fixture or production database is reset by the implementation.

Publication first locks/revalidates the current account/revision and records a durable cleanup reservation, then performs create-only PUT outside SQL. A second owner lock rechecks the session/role/revision, confirms the uploaded ETag/length/type via conditional HEAD, and atomically publishes the safe URL/key, increments its revision, queues the detached previous key and removes the new object's reservation. PUT success followed by revocation, conflict or SQL failure therefore leaves a discoverable orphan without destroying the saved photo. No application path reuses an immutable object key.

## Cleanup operations

R2 credentials need PutObject, HeadObject, DeleteObject and ListObjectsV2 for the intended avatar prefix/bucket, alongside the existing product policy. Use the runtime-configured account/bucket and an HTTPS public media origin, never the S3 API endpoint or signed query URL. Upload is server-proxied; this feature does not require browser-to-S3 CORS. Verify actual hosted credentials/CDN behavior during the release checks.

Run `npm run worker:avatar-cleanup` as a separate supervised process in addition to the existing product-image cleanup worker. The prepared standalone artifact includes `scripts/avatar-cleanup-worker.mjs` and its shared ingress protocol. Configure `APP_URL`, `MEDIA_CLEANUP_ORIGIN` (the authenticated private application listener), distinct `CHECKOUT_SWEEP_SECRET` and `TRUSTED_PROXY_SECRET`, and `MEDIA_CLEANUP_DATABASE` matching the actual database. The worker signs POST `/api/internal/avatars/cleanup`, also supplies independent Bearer maintenance authentication, checks the explicit database target, processes two due jobs per request and retries every sixty seconds. Application/worker environment and credentials remain private operator configuration. The endpoint rejects browser Origin mismatches and unsigned production traffic.

Detached keys and abandoned upload reservations have a 24-hour grace period; provider LastModified must also be at least 24 hours old. Owner-row then job locks serialize application photo publication/removal with cleanup. A global reference check retains live User or Product cover/gallery references even across prior CDN domains. Cleanup keeps failed jobs with bounded, redacted retry metadata, treats an exact provider 404 as already removed, and safely retries deletion followed by SQL rollback. Current SQL references and immutable keys are assumed; direct external bucket writers must follow the same ownership protocol.

Manual orphan reconciliation is dry-run by default and handles one SDK page of at most 100 avatar keys plus at most 25 queued jobs:

```powershell
npm run cleanup:avatars
npm run cleanup:avatars -- --cursor=<returned-token>
# After reviewing the exact database, prefix and dry-run result:
npm run cleanup:avatars -- --apply
```

Use the returned cursor for later pages; after deleting objects a fresh scan may be preferable because provider listings are not a transactional snapshot. Only explicitly managed avatar keys are candidates. Unsupported/unowned keys are never generalized into deletion targets. Removing/replacing a photo clears its account reference immediately; immutable browser/CDN caches or previously downloaded copies can outlive removal. This worker does not claim a CDN cache purge.

## Local verification and release boundary

Use an isolated loopback PostgreSQL `audit_*` database and the repository's guarded TEST_DATABASE_URL. Reproduction:

```powershell
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:avatars
node --test tests/native/ingress-gateway.test.mjs
git diff --check
```

Unit/DOM tests cover real selection/retry/owner/unmount behavior, signup handoff and verification failure, the actual profile component's unsaved-field preservation, strict parsing, deadline/stream bounds, signature/decoding/dimensions and slot release. Integration tests use real PostgreSQL, Sharp and S3 SDK requests against a SigV4-verifying local HTTP service; they cover revisions, outbox durability, rollback, provider failure, legacy restoration/privacy, actual handler/profile/register bypasses, concurrency, reference retention, retries, pagination and a fresh-database migration rehearsal.

The prepared-artifact avatar smoke invokes the compiled Next handlers with real HTTP, login cookies, ingress signatures, SQL and Sharp. Its test-only Node preload transports requests for one exact synthetic R2 host to the local SigV4 fixture; application code/configuration has no alternate provider endpoint. The fixture verifies signatures and supplies object/CDN bytes. This is distinct from hosted R2 DNS/TLS, actual Cloudflare permissions, browser rendering and deployed worker supervision. Those remain AUD-044 release checks, alongside other hosted providers/Linux/Docker. No production migration, provider change or deployment is implied by these local checks.
