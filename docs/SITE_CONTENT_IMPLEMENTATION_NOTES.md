# AUD-046: public content, legacy routes and truthful documentation

**Status: implemented and locally verified; remote CI pending the implementation push.** The tracked total remains 48/51 until that result is inspected and recorded; AUD-049 and the owner's external AUD-051 SMTP revocation also remain open.

## Connected behavior

The administrator content index is `/admin/settings/content`, linked from Settings. It opens the five fixed information documents (About, FAQ, Returns, Privacy and Terms), lists saved articles with server pagination and accepts a permanent article URL slug. The resource editor supports structured plain text, section order, private draft saves, explicit review/publication, withdrawal and retained revision inspection. Titles and bodies support well-formed Unicode; route slugs use a closed lowercase ASCII format.

Public pages select only the retained reviewed publication relation. A later private draft does not replace the published document, its metadata, FAQ structured data or sitemap modification time. Missing information publications produce clearly identified operational guides with support links, noindex metadata and no sitemap entry. Those guides do not claim to establish operator policies. Missing/draft/withdrawn articles are not found; a real database failure is not converted into a healthy empty blog or an unconfigured guide.

The homepage summary reads the published About summary. Footer sample social links and unsupported payment-brand claims are removed. Layout/category/product fallback descriptions no longer invent market leadership, warranty or express shipping. The README distinguishes implementation, required operator configuration and actual evidence from hosted verification still needed. Its unsupported MIT badge/link is removed because no license file is checked in; this work does not invent an owner license grant.

Legacy `/verify-email` validates and encodes a single address before redirecting to the real OTP flow, with a usable entry form otherwise. Root `/order-success` accepts an unambiguous UUID reference and forwards to the existing protected confirmation route; client payment claims confer no state. `/unauthorized` uses the current authenticated role to offer only a closed dashboard destination. The unsupported Stripe customer portal returns an explicit private/no-store 410 response with order/support destinations; no subscription implementation is implied.

## Authority, concurrency and durability

Every private API request requires the current administrator and `X-Site-Content-Owner`. The service independently locks and checks the verified administrator's current database role/session before any private read, write or receipt retry. It serializes document changes, requires the expected revision and hashes each normalized decision. Retrying the same reference returns its retained original receipt; changed payloads/references and stale competing editors fail.

The client retains an exact account/resource-bound pending decision before sending it. Uncertain responses lock edits and offer the original retry after reload. Refreshing saved state preserves typed fields and their reviewed revision. Loading a newer draft is explicit. Account changes abort requests and remove the private editor. Raw transport diagnostics are not rendered. A confirmed older receipt is described as the original decision and is not mislabeled as the latest saved state.

New additive migration `20261105090000_site_content_publication` creates `SiteContent` and immutable `SiteContentRevision`; it does not seed public content or alter previous migration files. The database enforces supported addresses, bounded structured text, contiguous versions, matching before/after state, current verified administrator actors, reviewed publication evidence and UTC timestamps. Deferred constraints disallow orphan decisions; a retained compound foreign key binds publication to its exact revision. Document/history deletion and history rewriting are rejected. Indexes bound publication and administrator collection queries. Readiness now requires migration 37 and checks both content relations without reading their records.

## Verified so far

Local focused evidence on 5 November 2026:

- 16 actual PostgreSQL integration cases passed, including private/public separation, exact concurrent receipts, real user-row lock/revocation, direct SQL guard failures, history paging, three database timezones, HTTP media/body/query/owner/rate checks, missing-relation 503, publication-only sitemaps and upgrade from migration 36 with existing account/catalog/order/event records preserved.
- Five validation/policy tests, five public rendering/metadata/error tests, eight Strict Mode editor tests and seven legacy-route cases passed. The earlier combined five-suite run reported 40 passed; one additional sitemap integration case subsequently passed in the 16-case database suite. Do not confuse these focused counts with a completed repository-wide run.
- TypeScript and full repository lint passed at the recorded intermediate checkpoint. Final validation must be repeated after any further source changes.
- The new SQL was applied through the actual migration CLI in a fresh owned local fixture before the later collection index addition. Subsequent integration cases applied all current migration SQL, including that index. Final CLI/build/compiled checks below remain authoritative release gates.

The prior temporary PostgreSQL directory was missing a required system file. It was not repaired, deleted or reused. A new loopback-only, disposable audit PostgreSQL 18 cluster was initialized under the operator's local audit-fixture directory; the test control pointer now targets that cluster. Only synthetic fixture databases are created/dropped by these checks. No production connection, migration or provider action is part of this verification.

## Remaining verification before task closure

The first prepared production/standalone build passed. The first compiled smoke and all eight new browser cases failed at assertions: the article test expected a pre-stream HTTP 404 despite the parent loading boundary already streaming 200, and the retry test's unscoped alert locator also selected Next's route announcer. The installed `not-found.js` guide documents the streamed status behavior. The corrected checks require actual missing-page UI, noindex metadata and no private article title in either HTTP case; no error or missing-content assertion is skipped. The retry locator identifies the actual application's failure message. The original failed logs and browser JSON were preserved locally.

The browser inspection also exposed an unsupported header promise, “Free Shipping on Orders $50+”, inconsistent with the actual checkout currency/policy. It now links to support for delivery information. The global missing-page screen now offers useful catalog, article and support destinations. These source changes require a new build and compiled/browser rerun; the earlier successful build does not certify them.

The subsequent production/standalone build passed. The compiled smoke now passes all nine groups, including actual CLI migration of a fresh owned database, all five fixed-page publications, published About summary on the homepage, continued private draft isolation, retained publication sitemaps, current administrator/session checks, ingress/origin rejection and a real missing-relation 503. Legacy email redirects are checked as either a pre-stream 307 with the exact Location or an actual same-origin refresh meta destination after streaming, as documented by the installed redirect guide.

The full browser run completed with 39/40 passing: all eight new content cases passed in all four projects; the existing WebKit administrator case failed because the test recovery helper omitted the original wishlist read's `X-Wishlist-Owner` header. The application's owner guard correctly returned 409. The recovery helper now preserves a closed list of original account/resource owner headers in both protocol and pre-dispatch captures. Cookie/authorization and arbitrary headers remain excluded; mutation replay policy and the mandatory recovered 200 are unchanged. A new native test executes the serialized observer and confirms both owner preservation and credential exclusion; all five focused recovery cases passed. The 39/40 JSON and initial failed-run JSON/logs were preserved locally before rerun.

The mandatory full isolated gate completed successfully: **172 suites / 1,250 tests, zero skips**, with actual CLI migration and two idempotent seed executions in a newly owned disposable database. Elapsed Jest time was 599.923 seconds; it is test execution evidence, not a marketplace performance benchmark. TypeScript, Prisma validation, **all 16 native tests**, repository lint and `git diff --check` passed. The focused readiness and public/editor/legacy regression run also passed 27 tests. README local link targets all exist after removal of the unsupported license link.

The complete browser rerun passed **40/40 cases in 4.7 minutes**, with zero retries, including all ten cases on Chromium, Firefox, WebKit and mobile Chromium. The previous WebKit administrator failure is resolved with original owner-header preservation and an unchanged recovered-200 requirement. The compiled outage suite also passed actual table drift/recovery, correlated/redacted error references, TCP database outage/session recovery, bounded stalled connection behavior and Redis outage/liveness separation after readiness advanced to migration 37.

All required local checks are now terminal and successful. The separate implementation commit/push and remote strict-lint/PostgreSQL 16/18 CI results still need to be recorded before closure. No pending remote result is represented as successful.

The task remains open until the complete result is reviewed, recorded and committed/pushed separately with `Assisted-by: OpenAI Codex`. Do not mark it complete based on focused tests alone. There has been no production deployment, hosted provider acceptance, actual money movement, external email delivery, main merge or owner credential revocation.

## Reproduction

Privately set `TEST_DATABASE_URL` to a separate loopback `audit_*` control database with disposable-database creation permission. Do not point these commands at production or at a shared application database.

```sh
npm run test:isolated
npm run test:native
npx tsc --noEmit
npx prisma validate
npm run lint
npm run build
npm run smoke:site-content
npm run test:browser
git diff --check
```

The compiled and browser fixtures migrate their own newly generated local databases. Readiness requires the completed migration record and enabled OTP clock protections. Actual mail, R2, Stripe and tunnel acceptance remain separate operator deployment checks described in the existing runbooks.
