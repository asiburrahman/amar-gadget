# Brand directory and collection filters

AUD-018 makes directory links, the products page, public API and product-read action use the same brand resolver. Generated links use `/products?brand=` with the exact encoded database slug, or a brand ID fallback when a legacy slug cannot satisfy the bounded query contract. `brandId` accepts a database ID; `brand` also accepts an ID as a compatibility alias. An exact stored slug takes precedence, followed by an exact ID, then an unambiguous case-folded slug. Names are not fuzzy-matched. If differently cased stored slugs make an alias ambiguous, use its canonical slug or explicit ID.

The fallback uses parameterized PostgreSQL lower-case equality with a two-row bound. It does not treat `%`, `_` or backslashes as LIKE patterns. A real SQL regression first demonstrated that an ILIKE-backed equality could resolve an unknown wildcard string to a brand; literal equality fixes that behavior. See [Prisma filtering semantics](https://www.prisma.io/docs/orm/v6/prisma-client/queries/filtering-and-sorting).

## Query behavior

- One `brand` and/or one `brandId` value is accepted. If both exist, they must identify the same brand. Repeated, conflicting, control-character or overlong values are rejected rather than silently choosing one. Slug/alias input is bounded to 120 characters and explicit IDs to 64 safe identifier characters.
- Missing database brands produce an empty collection with a clear “Brand not found” message, never an unfiltered catalog. A real brand with no public products remains a valid named empty collection. Blank brand values mean no brand filter.
- The public API uses HTTP 200 plus `brandFilter.state: "missing"` and an empty products array for an unknown brand; invalid/conflicting input uses HTTP 400. Found results include the resolved ID/name/slug. Lookup failures are HTTP 503 and are not reported as missing brands.
- The products page displays the actual selected brand name, combines its predicate with category/search/sale filters and offers a “Clear brand filter” link. That link preserves other query values and removes the page number so the next listing begins at its first page. Metadata uses the real brand name; missing/invalid collections are noindex.
- Every public product query retains product and seller approval predicates. Private-status product-action queries still require their existing role/ownership authorization even when a requested brand does not exist. Brand lookup is not an alternative authorization path.

React request-scoped memoization shares the primitive brand arguments between metadata and the page; there is no persistent negative cache to hide newly created brands. No database schema or production records are changed.

## Real directory data

The brands page reads actual stored names/slugs/logos and public-visible product counts. Hard-coded “120+ Products” and unverified partner/retailer badges are removed. The directory uses stable name/ID ordering and twenty-four-brand pages, including empty, invalid-page and unavailable states. All stored brands remain reachable through pagination. Product filtering/pagination/sort improvements beyond this brand contract remain the next task, AUD-019; this task does not mark the wider data-truthfulness or performance audits complete.

## Verification

With an isolated local migrated `audit_*` database, set `TEST_DATABASE_URL` and run:

```sh
npm test -- --runInBand
npm run build
npm run smoke:brands
```

Nine integration cases use actual PostgreSQL, application API/action functions and server-rendered component trees. They cover canonical slugs, IDs, case aliases, literal wildcard characters, ambiguous case collisions, brand/category/search/sale intersections, pending products/blocked sellers, unknown versus existing-empty brands, repeated/conflicting parameters, actual directory counts/links, filter clearing and safe service failures. Rendered metadata and noindex states are asserted. The built-artifact smoke separately follows real directory links and verifies actual HTTP API/HTML behavior with unique local fixture rows, then removes its rows and processes. No hosted browser or production data is used.

The full Jest setup now validates and selects the local test database **before** static application imports can create a cached Prisma client. Without TEST_DATABASE_URL, unit-only runs receive a closed-loopback dummy database and integration suites skip; ambient production URLs are never inherited. Remote targets, non-audit database names and connection query overrides fail before test-module imports, with a constant error that does not echo credentials. Six isolation cases verify this policy. Earlier recorded implementation runs explicitly selected the local audit database; this additionally protects future runs that supply only TEST_DATABASE_URL. Provider fixtures remain test-only. Live browser, hosting/provider checks and full CI remain AUD-044.
