# Canonical origin, public sitemaps and structured data (AUD-043)

Set **APP_URL** to the exact deployed application origin. It is the same validated origin used by checkout and trusted ingress. SEO does not fall back to NEXT_PUBLIC_APP_URL, VERCEL_URL, a request Host header or a hard-coded production domain. HTTPS is required except for loopback development/testing. No domain, Search Console property or external account is configured automatically by this change.

Root metadata waits for a request with the installed Next `connection()` API before resolving metadataBase. This permits one prepared standalone artifact to run with different deployment origins without retaining a build-machine hostname. Consequently, pages that inherit this request-time metadata are dynamically rendered; static assets remain packaged normally. Caching/performance should be measured under AUD-042/044 rather than assuming earlier static-page behavior is unchanged. The new HTTP smoke starts the same artifact twice with different runtime origins and an irrelevant public alias, then checks actual canonical/OG/schema/robots/sitemap output.

## Public catalog and metadata

Product detail and its API share a request-cached public reader with product/seller approval checks. It resolves exact slugs, exact ID compatibility and unambiguous literal case aliases. Parameterized lower-case equality avoids ILIKE wildcard interpretation. Hidden exact slugs cannot be reinterpreted as another public product. Review relation output is bounded to twenty recent rows; verified review submission/aggregation remains AUD-024.

A resolved ID/case alias redirects permanently to the actual product slug. Unusable legacy slugs use a stable ID destination, avoiding a root/dot-segment canonical. Encoded paths, metadata canonical/OG URL, breadcrumb destinations and Offer URL all identify that product. Category aliases resolve through the shared taxonomy contract and redirect to the real category destination; missing categories no longer broaden into a different product collection. Category landing results reuse the bounded listing/filter UI. Missing/hidden products/categories noindex; product data outages produce safe unavailable responses and metadata rather than claiming the product was absent. The product API distinguishes 404 from 503.

Product JSON-LD is rendered by the actual detail route and HTML-safe serialized. It uses the current effective price (`discountPrice ?? price`), BDT, the actual stock-derived InStock/OutOfStock value, stored product ID as the internal SKU, actual brand/category when present and a validated absolute image URL when available. Missing brand/image/condition/price-expiry/seller facts are omitted. It no longer invents an annual priceValidUntil, NewCondition, an operator brand or an operator seller. This follows [Google's Product structured-data documentation](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) without claiming an external rich-result test, search eligibility, ranking or Merchant Center approval.

Homepage Organization/WebSite schemas are actually rendered, use the same origin and advertise the working `/search?q=...` contract. Unverified social handles, phone numbers and nonexistent default logo/OG assets are omitted from SEO helpers. This does not certify all existing informational/marketing copy; public content/policy review remains AUD-046 and actual banner management remains AUD-029.

Public landing pages have their own canonical paths. Product facets normalize resolved taxonomy selectors; the basic category filter shares the category landing canonical. Search/sale/price/sort/custom-size/combined-facet and out-of-range states noindex while keeping useful navigation followable. Directory pagination uses self URLs and noindex/follow rather than incorrectly canonicalizing every page to page one. Placeholder legal/blog destinations are not advertised in the sitemap pending AUD-046 content completion.

## Sitemap routes and failure policy

`/sitemap.xml` is now a real XML sitemap index. It points to `/sitemaps/pages.xml` plus numbered product/category/brand shards, each containing at most **1,000** entries. Product shards include all currently approved products whose sellers remain approved, including truthful out-of-stock detail pages. Taxonomy shards require at least one such public product. The default page list contains existing public destinations and excludes account/cart/checkout/search/order/tracking/private flows and unfinished placeholders.

URLs use the configured absolute origin and XML escaping. Product/taxonomy row update timestamps supply lastmod; static pages do not fabricate a new modification date on every read. Counts/results share a repeatable-read snapshot per response, stable ID order, four-second statement limits and ten-second transaction deadlines. Invalid or out-of-range shard names return 404 before a deep offset; unavailable SQL returns no-store 503 with Retry-After, never a successful empty catalog sitemap. Dynamic file boundaries can shift as products are inserted or moderated; crawling separate responses is not a cross-request database snapshot.

The [Sitemap protocol](https://www.sitemaps.org/protocol.html) limits an index to 50,000 sitemap entries and bounds URL length. This implementation checks those bounds and fails explicitly if exceeded instead of silently dropping records; shard rows are well below the per-file URL limit. This is a bounded export contract, not a benchmark or a claim that an arbitrary-size database has passed production load testing.

## Private flow indexing

The proxy adds `X-Robots-Tag: noindex, nofollow` to APIs, auth, dashboards, account, cart/checkout, wishlist/compare, search, order-success/status and tracking paths, including protected redirects and rejected ingress responses. Auth/dashboard layouts also emit noindex metadata. Product missing/hidden/error states use their own metadata. These indexing controls do not replace actual session/role/ownership protections.

robots.txt advertises the current sitemap origin and leaves pages crawlable so supported crawlers can see noindex. [Google documents that blocking crawling can prevent a crawler from observing a noindex header or tag](https://developers.google.com/search/docs/crawling-indexing/block-indexing). Authentication remains enforced; this is not a promise that arbitrary crawlers obey indexing directives or that previously indexed URLs disappear immediately.

## Verification

Use a disposable local audit_* database with all checked-in migrations. Set TEST_DATABASE_URL, DATABASE_URL and DIRECT_URL to it before tests/build. Never select the application's real database. Run Jest and native smoke runners sequentially when sharing that database.

```powershell
npm test -- --runInBand
npx tsc --noEmit
npm run build
npm run smoke:seo
npm run smoke:ingress
npm run smoke:catalog-actions
npm run smoke:brands
git diff --check
```

The SQL integration suite invokes actual exported robots, sitemap-index/shard handlers, product/category metadata/pages and the product API. It creates over one thousand real product rows, verifies shard completeness/no duplicates and moderation, extracts Product JSON-LD from rendered detail HTML, checks prices/stock/media/escaping/redirects/facets, and injects safe outage failures at the database boundary. The native SEO runner starts the prepared server at two runtime origins and inspects real XML/HTML/headers, then starts a separate process pointed at a closed local database port and proves product noindex, safe API 503 and no database-detail exposure. Existing ingress/RSC/prefetch/origin/budget, compiled catalog/campaign actions and brand/search/comparison HTTP regressions pass independently. Local Redis protocol fixtures are test-only.

No migration is added by AUD-043. No production deployment, provider account, DNS, Search Console, live crawler submission, interactive browser or external validation tool was exercised. Linux/Docker and hosted-service/browser release verification remain AUD-044. Broader operational/query/lint/schema work retains AUD-042/045/049; media URL/deletion lifecycle is still the original AUD-047, and SMTP credential revocation remains AUD-051.
