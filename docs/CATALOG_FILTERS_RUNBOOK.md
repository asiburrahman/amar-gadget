# Product filters, ranking and pagination (AUD-019)

`/products`, `GET /api/products` and the product-read action use `getCatalogListing`. The products form submits GET query parameters through the installed Next Form component. Changing filters resets the page; result links preserve filters. Query-derived React keys restore controls on URL navigation. Category and brand choices have searchable twenty-five-option pages and retain an off-page selected option. Failed lookups preserve selection and retry the failed search/page; unmount cancels pending requests.

Supported parameters:

| Parameter | Contract |
| --- | --- |
| `search` / `q` | Trimmed literal text, at most 200 characters. Conflicting aliases are invalid. SQL wildcards are escaped. |
| `category`, `categoryId` | Exact slug/ID, then an unambiguous case-insensitive slug/name compatibility match. Existing wearables/computers aliases resolve only after a real match is absent. |
| `brand`, `brandId` | Shared AUD-018 resolver. Supplied selectors must agree; an unknown selector returns an empty collection. |
| `minPrice`, `maxPrice` | Inclusive BDT amounts, zero through 99,999,999.99, at most two decimals; minimum cannot exceed maximum. Uses `discountPrice ?? price`, matching checkout. |
| `filter=sale` | Positive discount strictly below regular price. |
| `sort` | `latest` (default), `price_low`, `price_high`, `rating`, `bestsellers`. |
| `page`, `limit` | Integer page 1–1,000,000; page size 1–48, default 12. Form offers 12/24/48 and preserves other valid incoming sizes. |

Repeated known fields, malformed values and unknown sorts return API 400 and a page correction state. Unknown unrelated tracking parameters are ignored. Empty, missing taxonomy, invalid query, out-of-range page and unavailable service are distinct states. Public queries require approved products and approved sellers; the action's private pending/rejected scopes additionally recheck current actor verification, role, ownership and session version in SQL.

Exact counts and bounded result rows share a repeatable-read transaction. An out-of-range page avoids a deep result OFFSET. Queries have a four-second PostgreSQL statement deadline and a ten-second transaction deadline; this is not a production performance benchmark. Stable ID tie-breaking prevents tied products from repeating across unchanged pages. Filters intersect rather than replace each other.

Price sorting uses the current effective price. Rating sorting uses stored rating, review count, newest creation and ID; review integrity remains AUD-024/047. Best sellers sum order-item quantities only where the parent order is PAID and DELIVERED. These are gross delivered units, not net revenue or future refund settlement. Zero-sale products follow sold products in the general sorted listing; the homepage shows only positive-sale products and has separate empty/unavailable states. Refund policy and reconciled financial metrics remain AUD-015/034.

`GET /api/catalog/options?kind=brand|category&search=...&page=...` supplies bounded live choices. It validates duplicate fields and search limits and applies an IP budget of sixty requests/minute. It returns real stored taxonomy records, including choices with no currently visible products. Applying one with no results shows an empty collection.

## Reproduce verification

Use a disposable local `audit_*` PostgreSQL database with the checked-in migrations and seed; set TEST_DATABASE_URL before running Jest. Never select the application's real database. See the runtime and trusted-ingress runbooks for production configuration.

```powershell
npm test -- --runInBand
npx tsc --noEmit
npm run build
npm run smoke:brands
npm run smoke:standalone
npm run smoke:catalog-actions
git diff --check
```

The SQL integration suite creates thirty products, separate approved/blocked sellers, paid/unpaid/cancelled/processing orders and twenty-eight additional taxonomy options. It checks actual row IDs, exact totals, intersected predicates, prices, rank, ties, pages, literal search, current authorization and rendered controls. UI tests exercise named GET data, range validation, selection preservation, retry targets and cancellation. The expanded brand HTTP smoke runs the prepared application with a local Redis protocol fixture and actual PostgreSQL: it checks API pages/prices/ranks, server-rendered controls, live options and homepage sales wiring. These checks do not claim an interactive browser walkthrough or live hosted Redis/provider verification; those remain release work under AUD-044. No migration is added for this step.
