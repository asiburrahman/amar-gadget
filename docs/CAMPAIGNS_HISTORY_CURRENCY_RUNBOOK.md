# Campaigns, browsing history and BDT pricing (AUD-037)

This step completes the original deals/history/currency task. AUD-018 already replaced fixed brand-directory counts, and AUD-019 wired actual paid-delivered best-seller ranking. Those contracts remain in force. The homepage brand strip now also reads stored brand names and actual approved-product/approved-seller counts, with directory links and a separate unavailable state; its old unrelated stock wordmarks are gone.

## Campaigns and price policy

`/deals` and the homepage read enabled campaigns whose UTC window has started and not ended (`start <= SQL now < end`). Each member must still be an approved product from an approved seller, in stock, with a positive discount below its regular price. A campaign with no eligible members is not advertised. Products removed, blocked, unapproved, sold out or no longer discounted disappear on the next request. Public count and rows share a repeatable-read snapshot, four-second statement bounds and a ten-second transaction deadline. Pages contain at most six campaigns; each campaign contains at most fifty ordered members. Out-of-range and invalid pages have explicit recovery links.

**A campaign is a curated, time-limited listing of existing catalog discounts. It does not create a separate price, quota or reservation.** Current product prices are shown and checkout independently confirms actual prices/stock. Ending a campaign hides its listing; it does not clear a product's independently configured discount. The public card and admin editor state this policy. No invented sold counts, percent-claimed progress bars or restarting forty-two-day countdown remain. Product links open actual detail pages rather than a fabricated deal ID or a cart that was never populated.

Window eligibility uses the SQL transaction clock explicitly in UTC. The timestamp returned to the browser is derived from SQL epoch; UTC campaign dates are serialized explicitly. An actual Asia/Dhaka database session exposed an offset mismatch in raw timestamp decoding during implementation, so tests check the returned clock and end time against real time. The client countdown advances from that server time using a monotonic timer, independent of a wrong browser wall clock, and removes the campaign's product cards when its window ends. A reload fetches current configuration and seller/product visibility. Open pages are not an instant admin push channel.

Administrators reach `/admin/campaigns` from the dashboard. They can create drafts, edit title/slug/description, set explicit UTC start/end times, enable/disable, search paginated real discounted products, add/remove/reorder up to fifty members and delete campaigns. Empty search results, lookup failures with retry, stale-save conflicts and failed mutations remain visible. Successful edits refresh the current data. Each save checks current administrator verification/role/session version under the account lock, locks the edited campaign, validates referenced products, replaces membership atomically and increments an optimistic version. Deletes also require the current version. Conflicting slugs or deleted products return actionable failures; copied revoked sessions cannot mutate campaigns. Enabled campaigns must have at least one currently eligible product when saved, and eligibility is re-evaluated on every public read.

Migration `20261029110000_catalog_campaigns` adds Campaign/CampaignProduct only; it does not invent campaign records or change product prices/stock. SQL constraints enforce valid windows/slugs/versions and at most fifty distinct ordered product positions. Campaign deletion cascades its memberships while preserving products. Product deletion removes only that product's campaign memberships. Readiness requires this eleventh migration before this revision is deployed. Apply through the normal backed-up, approved production rollout; this work applied it only to isolated local test databases.

## Actual recently viewed history

Only mounting an approved public product-detail page records a view. Prefetching a page is not a view. History stores at most twenty product IDs and timestamps under `amar-gadget-recent-history`, version 1, with thirty-day retention, recency order, duplicate removal and a Clear viewing history control. Invalid, oversized, expired or future-dated storage is discarded. No account identity, price snapshot or technical data is persisted. If storage is unavailable, the current session can still use in-memory history.

This is explicitly **this browser's history**, shared by people using that browser, not other shoppers' activity or an account-synchronized profile. Clearing it removes the local selection; signing into another account does not mislabel it as that account's data. Cross-device history is not advertised. The UI states this scope.

`GET /api/products/recently-viewed?product=ID&product=ID` validates up to twenty distinct bounded IDs, applies an IP budget of sixty requests/minute and returns only requested, currently public-visible products in request order with refreshed price/discount/stock. Responses are private/no-store. Missing or moderated rows are omitted without revealing their names. The UI refreshes on mount/history changes/window focus/visibility return; stale/unmounted requests are aborted. Failure and retry states never substitute newest products for viewing history. Empty history makes no SQL request and shows an honest empty state.

## One working currency policy

The store displays and charges **BDT**. The header states this fixed policy; its old cosmetic Dollar/Euro selector and dollar cart symbol are removed. Cart totals use catalog sale prices when present, while authoritative checkout quotes still refresh them on the server. The shared price component formats actual BDT and rejects unsupported currency relabeling; the normal formatter uses the actual taka symbol. Stripe's existing BDT line-item currency now derives from the same constant. No exchange rate, conversion or alternate-currency settlement is claimed or introduced.

Shared cards/detail, campaign cards and browsing history use the same nullish effective-price rule as checkout (`discountPrice ?? price`), including legacy zero-valued discounts; new writes still follow the stricter validated price rules. This does not rewrite or certify all legacy catalog data. Homepage featured products require the actual featured flag, sale products require real discounts and top-rated collections require stored ratings/review counts. Empty sale/rating collections no longer silently fall back to featured products. Home reads are bounded and independently report collection failures. Review eligibility/aggregation integrity remains AUD-024; other promotional claims/banner wiring remain AUD-029/047.

## Reproduce verification

Use a disposable local `audit_*` PostgreSQL database, apply all checked-in migrations and set TEST_DATABASE_URL before Jest. Never use the application's real database. Run Jest and smoke runners sequentially when sharing that database, because older checkout tests assert global fixture counts. Separate parallel runners require separate databases.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/audit_amar_gadget'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_URL = $env:TEST_DATABASE_URL
npx prisma migrate deploy
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:catalog-actions
npm run smoke:brands
npm run smoke:standalone
git diff --check
```

Coverage includes actual SQL campaign creation/membership, eligibility/window/moderation, page counts/order/bounds, stale/unauthorized/revoked mutations, deletion/foreign-key behavior, UTC clock regression, fresh-database earlier-migration upgrade preserving catalog data, history ordering/current-price/visibility/private cache/rate budget, plus UI countdown expiry/clock skew/cleanup, mounted-view recording, retry/clear/abort, empty collection truth, UTC editor payloads/failure preservation, real brand counts and BDT/legacy-zero price display. Native prepared-server checks exercise compiled Next Action login/save/delete, actual SQL and homepage/deals updates, disable/expiry/stale/revoked denial, history HTTP hydration and brand/currency regressions. Local Redis protocol fixtures remain test-only.

Interactive browser walkthrough, hosted providers, Linux/Docker, production deployment and broader query/lint/schema release gates remain their original open tasks (AUD-042/044/045/049). Four existing native-image lint warnings in the touched header/bottom-widget files are recorded separately. No production data, payment/email/provider state or credentials were changed; SMTP credential revocation remains AUD-051.
