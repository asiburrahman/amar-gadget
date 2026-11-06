# Amar Gadget — Deep audit ও implementation task list

অডিট তারিখ: 28 October 2026 (Asia/Dhaka)

Audited source baseline: `37a80a8` (`main` at audit start)

Work branch: `codex/deep-audit-2026-10-28`

Prepared with: OpenAI Codex, at the repository owner's request.

**Implementation update:** this file preserves the original audit snapshot. See the [implementation log](CODEX_IMPLEMENTATION_LOG.md) for completed fixes, commit links and newer validation evidence.

এই commit অডিট, source inventory এবং offline diagnostic যোগ করে। নিচের feature fixes এখনো করা হয়নি। এই নথি repository-তে Codex-assisted কাজের যাচাইযোগ্য record; কোনো certification, live payment success বা production readiness-এর দাবি নয়। Git commit history ও branch diff দিয়ে এই contribution দেখা যাবে।

## সিদ্ধান্ত ও scope

প্রজেক্টে কার্যকর implementation-এর ভিত্তি আছে, কিন্তু README-তে বর্ণিত পূর্ণ marketplace এখনো সম্পূর্ণ wired নয়। সবচেয়ে বড় blocker হলো HTTP database adapter-এর সঙ্গে interactive transaction-এর অমিল। Checkout, OTP verification, password reset এবং Stripe confirmation এই একই সমস্যায় আটকে যায়। অন্য বড় সমস্যা হলো unescaped product JSON-LD, suspended seller-এর পণ্য কিছু public page-এ দেখা যাওয়া, এবং অসম্পূর্ণ dashboard/management flows।

সমস্ত `app/**/page.tsx`, `app/**/route.ts` inventory করা হয়েছে: **64 pages, 29 API route files, 26 text-only placeholder pages**। Critical server actions, schema/migrations, stores, auth, profile, upload, product detail/listing, storefront components, deployment config ও existing tests পর্যালোচনা করা হয়েছে। Route-by-route source তালিকা: [audit inventory](audit-route-inventory-2026-10-28.json)। Inventory-তে placeholder false মানেই সম্পূর্ণ feature নয়।

এই অডিট source tracing, installed dependency inspection, offline adapter reproduction এবং local automated checks-এর ভিত্তিতে। Production database, migration execution, SMTP delivery, Redis service, R2 upload, real/test Stripe event delivery ও authenticated browser walkthrough চালানো হয়নি। কোনো customer data, secrets বা production services পরিবর্তন করা হয়নি। UI appearance/accessibility-এর পূর্ণ browser audit বাকি।

## কী implementation পাওয়া গেছে

| Area | পাওয়া implementation | বর্তমান সীমা |
| --- | --- | --- |
| Auth | Zod registration/login, signed JWT, HttpOnly cookie, OTP generation/email code | OTP/reset transaction blocker; security tasks নিচে |
| Catalog | DB-backed listing/detail/category queries; public detail/API-তে approval checks | Homepage/category visibility inconsistent; advanced filters UI নেই |
| Admin | Stats, product approval/price/delete, seller moderation, order actions | অনেক management route placeholder |
| Seller | Add-product form; dashboard catalog/orders/monthly tabs | Upload wiring, mixed-vendor fulfillment, payouts incomplete |
| Customer | Local cart/wishlist, profile/default-address update, orders, tracking | Cross-device sync/address checkout wiring নেই |
| Checkout | Server-derived identity/prices, stock guard, coupon DB validation, COD/Stripe branches | Transaction blocker ও recovery/idempotency gaps |
| Stripe | Token-protected checkout, verified signature, amount/currency checks, duplicate-payment guard, expiration restock | Live verified নয়; refund/reconciliation flow নেই |

## Validation record

| Check | Result | অর্থ |
| --- | --- | --- |
| `npm test -- --runInBand` | PASS: 4 suites, 17 tests | Existing unit tests; database/session mocked |
| `npx tsc --noEmit` | PASS | Type checking; runtime integration correctness নয় |
| `npx prisma validate` | PASS | Schema syntax/config valid; migration/data compatibility নয় |
| `node --check prisma/seeds/seed.js` | PASS | Seed syntax only; seed execute করা হয়নি |
| `npm run lint` | FAIL: 180 problems — 109 errors, 71 warnings | Current baseline; পুরোনো README numbers থেকে আলাদা |
| `node scripts/audit-offline.mjs` | Reproduced: `Transactions are not supported in HTTP mode` | Dummy connection string; কোনো DB connection/query হয় না |
| Production build | PASS: `npm run build` | Dummy database URL; environment validation bypassed; live dependencies not exercised |

Installed Next.js guides read: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `02-guides/authentication.md`, `03-api-reference/05-config/01-next-config-js/serverActions.md`। নিচের 1 MB body-limit finding installed guide থেকে যাচাই করা।

## অগ্রাধিকার

P0 = মূল flow blocker অথবা executable-content risk; P1 = core feature/security/data correctness; P2 = অসম্পূর্ণ management/UX/operational capability; P3 = cleanup/content। সব unchecked task এই baseline-এ open। Acceptance criteria পূরণ ও প্রাসঙ্গিক validation ছাড়া task close করা যাবে না।

## P0 — আগে সমাধান করতে হবে

- [ ] **AUD-001 — Transaction-capable database adapter বসানো।** Evidence: `lib/prisma.ts:21` creates `PrismaNeonHttp`; installed `@prisma/adapter-neon/dist/index.js` rejects `startTransaction()`. Callers include `server/actions/order/order-actions.ts:28,451`, `app/api/auth/verify-otp/route.ts:42`, `app/api/auth/reset-password/route.ts:77`, both transaction helpers in `app/api/stripe/webhook/route.ts`, and checkout inventory release. Impact: create order, verify account, reset password, payment confirmation/cancellation fail when transaction starts. Reproduce: `node scripts/audit-offline.mjs`. **Done:** suitable adapter/connection configured; disposable DB-তে successful commit, rollback, concurrent stock checkout, OTP consumption ও webhook idempotency integration tests pass. অন্য transaction tasks এইটির ওপর নির্ভরশীল।

- [ ] **AUD-002 — Product JSON-LD থেকে stored script injection বন্ধ।** Evidence: `app/(marketing)/products/[slug]/page.tsx:131` inserts `JSON.stringify(jsonLd)` with `dangerouslySetInnerHTML`; `lib/seo/schema.ts` copies name/description; product schema allows arbitrary strings. `JSON.stringify` does not escape an HTML `</script>` terminator. Impact: an approved product with a crafted name/description can break out of the script element. Approval is a prerequisite, not a sanitizer. **Done:** HTML-safe serialization (including `<` escaping), regression case containing a script terminator, rendered output-তে executable injected node অনুপস্থিত। Live exploit চালানো হয়নি।

## P1 — Auth, payment ও data correctness

- [ ] **AUD-003 — সব storefront query-তে seller approval এক করা।** Evidence: `app/(marketing)/page.tsx` only filters product `status: APPROVED`; `app/(marketing)/categories/page.tsx` nested product query and `categories/[slug]/page.tsx` also omit seller approval. `/products` and detail/API do check seller approval. Reproduce after AUD-001: approved product-এর seller BLOCKED করুন; homepage/category vs product detail compare করুন। **Done:** blocked/pending/rejected seller-এর পণ্য কোনো public grid/count/detail/search-এ না আসে; shared visibility query and regression coverage।

- [ ] **AUD-004 — Checkout order creation idempotent করা ও abuse limit যোগ।** Evidence: `createOrder` generates a fresh token/user/order per call, reserves stock, and has no request idempotency key/rate limit. Guest access is supported. Browser loading state does not protect server action retries. **Done:** একই checkout attempt retry-তে এক order/এক stock decrement; bounded guest abuse; duplicate submit/retry integration test।

- [ ] **AUD-005 — Session তৈরি হওয়ার আগের abandoned reservation release।** Evidence: `createOrder` reserves stock before browser calls `/api/stripe/checkout`; expiry webhook only exists if a Stripe session was created. Browser/network loss between those calls leaves PENDING inventory reserved without a scheduled cleanup. **Done:** reservation expiry persisted; bounded cleanup/reconciliation; abandoned-before-session scenario returns stock once।

- [ ] **AUD-006 — Stripe cancel/failure-এ cart ও retry context বজায় রাখা।** Evidence: `app/(marketing)/checkout/page.tsx` calls `clearCart()` before navigating to Stripe; Stripe `cancel_url` points to `/checkout`. Returning from cancel gives empty cart; later retry cannot resume the original order. **Done:** cancel returns meaningful cart/order context, retry reuses appropriate pending order/session, successful verified payment clears cart।

- [ ] **AUD-007 — Coupon validation ও quote frontend/backend এক করা।** Evidence: cart accepts only hardcoded `AMAR10`, `WELCOME10`, `SUPER20`; server reads actual Coupon records, expiry, minSpend, fixed/percentage values. Arbitrary real DB codes cannot be applied; hardcoded codes can show success then fail checkout or show a different total. **Done:** server quote/validation endpoint or action; UI uses returned amount/reason; fixed, expired, min-spend, changed-price tests।

- [ ] **AUD-008 — Password storage upgrade ও compatible migration।** Evidence: `lib/auth.ts` uses synchronous PBKDF2-SHA512 with 1000 iterations and plain string hash comparison; README incorrectly says bcrypt. **Done:** explicit versioned password format, stronger reviewed work factor/algorithm, timing-safe verification, login-time rehash for existing accounts; benchmark bounded server cost. Existing users remain able to log in।

- [ ] **AUD-009 — OTP purpose/user binding ও atomic email-change consumption।** Evidence: `OtpToken` stores email/code/expiry only; `sendOtpEmail` serves registration/reset/email change; verify/reset accept the same email/code namespace. `change-email/verify` does not bind token to requesting user and updates user before separately deleting OTP. **Done:** separate purpose, requesting identity and target email, hashed code, atomic single-use consumption, per-account attempt budget; registration token cannot reset a password and email-change token cannot establish a login।

- [ ] **AUD-010 — Password reset/change-এর পরে পুরোনো sessions revoke।** Evidence: JWT lasts 7 days, `User` has no session version/revocation timestamp; reset/change only update password; `getCurrentUser` checks identity existence but no credential version. **Done:** copied old cookie fails after password reset/change; documented policy for keeping current session; centralized validation।

- [ ] **AUD-011 — Account endpoints-এ consistent validation/rate limits।** Evidence: change-email request/verify and change-password omit `rateLimit`; reset/change accept six-character passwords whereas registration requires stronger eight-character policy; profile PUT lacks Zod validation and returns raw exception messages. **Done:** shared password/schema policy, bounded strings/URLs, account+IP throttles, malformed input returns controlled 4xx, internal errors hidden।

- [ ] **AUD-012 — Seller status gate sensitive dashboard reads-এ বসানো।** Evidence: `member/layout.tsx` verifies role only; `member/dashboard/page.tsx` reads products/customer order data for the current seller regardless of sellerStatus, while `getSellerOrders` denies unapproved sellers. **Done:** explicitly define blocked/pending seller read policy and enforce it server-side consistently; blocked session cannot retrieve prohibited customer data. Keep status/appeal screen available as intended।

- [ ] **AUD-013 — Seller shipment status update atomic করা।** Evidence: `updateOrderStatusBySeller` reads PROCESSING then uses unconditional `prisma.order.update`; admin can cancel/restock in between. Seller can overwrite a terminal state with SHIPPED after a concurrent action. **Done:** guarded compare-and-update in transaction; concurrent seller ship/admin cancel yields one valid winner, stock/payment state consistent।

- [ ] **AUD-014 — Multi-vendor fulfillment per seller/item implement।** Evidence: seller action explicitly rejects orders containing another seller's items; schema only has order-wide status/tracking. Dashboard still offers Mark as Shipped for processing items. **Done:** vendor shipment/fulfillment model, ownership guards, partial delivery aggregation; each vendor only changes their shipment and sees permitted data; mixed basket walkthrough।

- [ ] **AUD-015 — Refund/reconciliation workflow যোগ।** Evidence: admin cancellation rejects PAID orders with instruction to refund first, but there is no refund action/API/status model; webhook does not process refunds/disputes. **Done:** authorized refund operation, provider reference/audit trail, webhook reconciliation, terminal-state/stock rules and retry tests; financial counters reflect refunds।

- [ ] **AUD-016 — Add-product upload form R2-তে wire করা।** Evidence: `member/add-product/page.tsx` FileReader data URL is sent twice as `imageUrl` and `images[0]`; `/api/upload` is never used there. It accepts a 5 MB file, while server actions retain default 1 MB request limit (`next.config.ts` has no bodySizeLimit). **Done:** direct presigned upload with progress/error, final public URL persisted, multi-image add/remove/gallery; a 2–5 MB valid image submits successfully without base64 DB fields।

- [ ] **AUD-017 — Product image/price validation ও admin mutation guards।** Evidence: product schema accepts arbitrary image strings, unlimited description/images, and discountPrice above regular price; `adminUpdateProductPrice` does not runtime-validate values; status mutation parameters are TypeScript unions only, schema statuses are strings. **Done:** bounded validated URLs/media references, positive finite DB-range price, discount constraints, runtime enum validation, malformed direct server-action payload tests।

## P1/P2 — Core storefront ও customer flow

- [ ] **AUD-018 (P1) — Brand filter links কার্যকর করা।** Evidence: `/brands` links `/products?brand=apple` etc.; ProductsPage reads neither brand nor brandId, and API GET also ignores brand. **Done:** canonical brand slug/id resolution across links/UI/query; Apple collection shows only Apple; unknown brand gets explicit empty state।

- [ ] **AUD-019 (P1) — Product listing advanced filters/sort/pagination wire করা।** Evidence: ProductsPage reads category/search/sale only and performs unbounded findMany; `getProducts` has filters/sort/page but page does not use it; `BestSellersSection` links `sort=bestsellers`, ignored by page. **Done:** accessible price/brand/category/sort controls, query-state navigation, bounded pagination and real count; advertised sort modes implemented or removed।

- [ ] **AUD-020 (P2) — `/search` ও `/compare` implement।** Evidence: both routes are text-only placeholders; website JSON-LD advertises `/search?q=...`; no comparison store/specification schema exists. Header's `/products?search=` path is a separate existing search implementation. **Done:** unified search contract; comparison selection, remove/limit/empty states and actual specifications; no dead advertised destination।

- [ ] **AUD-021 (P1) — Saved address checkout-এ ব্যবহার।** Evidence: profile API can create/update one default Address, but `/user/addresses` is placeholder and checkout uses hardcoded Dhanmondi/Dhaka values rather than saved addresses. **Done:** address CRUD/default selector with ownership guard, checkout prefill/selection, empty defaults requiring explicit entry; no example address accidentally submitted।

- [ ] **AUD-022 (P2) — Wishlist account sync এবং `/user/wishlist` wire।** Evidence: marketing wishlist is local Zustand persistence; `Wishlist` DB model has no read/write route/action; dashboard route is placeholder. **Done:** authenticated CRUD and guest merge policy; two sessions/devices see consistent wishlist; account changes do not leak another account's local items।

- [ ] **AUD-023 (P2) — Cart persistence contract নির্ধারণ/implement।** Evidence: `/api/cart` returns 501, no Cart model, cart persists under one browser key. **Done:** explicit local-cart product policy or authenticated cross-device storage; stock/price refresh before quote; account-switch behavior documented and tested।

- [ ] **AUD-024 (P1) — Verified purchase reviews end-to-end।** Evidence: `ReviewForm` returns null, `/api/reviews` only GET, customer/seller/admin review pages are placeholders; Product.rating/reviewCount have no write/aggregation path. **Done:** delivered-purchase eligibility, one-review policy, validation, submit/edit/moderation, aggregate update; review text renders on detail page. Also remove fake five-star fallback `product.rating || 5` for unrated items।

- [ ] **AUD-025 (P2) — Order success payment state সঠিকভাবে দেখানো।** Evidence: `/order-success/[id]` unconditionally says `Total Paid` for COD UNPAID and pending Stripe; one server read, no webhook-progress refresh. Guest View My Orders leads to login without account order history. **Done:** amount due/paid labels, pending/failed/cancelled state, bounded refresh or status check, guest tracking CTA; payment delay walkthrough।

- [ ] **AUD-026 (P2) — Tracking status history persist।** Evidence: order tracking timeline gives createdAt for first event and `Not updated` for all later events; schema has no status events; cancelled timestamp also uses createdAt. **Done:** append-only transition timestamps, real shipment tracking field management, customer timeline correct after each change; clarify polling vs live updates।

## P2 — Admin ও seller management completion

- [ ] **AUD-027 — Admin category/brand CRUD।** Evidence: `/admin/categories`, `/admin/brands` are placeholder; public APIs only GET; models do not support subcategory hierarchy advertised by README. **Done:** authenticated CRUD, slug uniqueness, image upload, in-use delete protection and intended category hierarchy; storefront updates after changes।

- [ ] **AUD-028 — Coupon admin management।** Evidence: `/admin/coupons` placeholder, no mutation route/action. **Done:** validated create/edit/deactivate/expiry/minSpend/fixed-percentage UI tied to AUD-007; preview agrees with checkout quote।

- [ ] **AUD-029 — Banner management থেকে homepage wiring।** Evidence: `/admin/banners` placeholder; Banner model exists but hero/promo components do not query active banners. **Done:** CRUD/upload/order/activation/link validation; toggling banner changes homepage; fallback shown only when no active banners।

- [ ] **AUD-030 — Admin users/members management ও analytics/report screens।** Evidence: `/admin/users`, `/admin/members`, `/admin/reports` placeholders; `/admin/analytics` renders hardcoded volume 8.45M, users 12,450, queue 8 and uptime 99.98% without data access; existing `/api/analytics` returns only four real aggregate metrics and is not used there. **Done:** replace fabricated metrics with queried values, define users vs sellers/members navigation; authorized pagination/actions; implement reports with real filters/exports and failure states; preserve last-admin safety where role changes supported।

- [ ] **AUD-031 — Seller catalog maintenance ও standalone orders page।** Evidence: `/member/products`, `/member/orders` placeholders; dashboard lists catalog but there is no seller edit/delete/restock action. Update schema alone is not wiring. **Done:** own-product edit/restock/archive, reapproval policy, ordered product retention, standalone pages or intentional redirects to dashboard tabs; ownership regression tests।

- [ ] **AUD-032 — Seller earnings/payouts/analytics পরিষ্কারভাবে implement।** Evidence: `/member/earnings`, `/member/payouts`, `/member/analytics` placeholders; schema has no payout/ledger/commission entity. Dashboard says earnings credited on delivered items but performs no financial posting. **Done:** define settlement policy, durable ledger/payout request/provider reconciliation where required; accurate explanatory labels until real settlement exists।

- [ ] **AUD-033 — Notification pipeline ও three-role inbox।** Evidence: `/api/notifications` returns 501; admin/user inboxes placeholder; no Notification model/event pipeline. **Done:** durable events for approval/order/payment, scoped inbox/unread state and delivery retries; seller inbox scope decided explicitly rather than assumed।

- [ ] **AUD-034 — Accurate customer ও seller metrics।** Evidence: customer dashboard queries only last 10 orders then labels their length All time and sums unpaid/cancelled totals as completed spend; seller dashboard sums all statuses, monthly ordersCount increments per OrderItem rather than distinct order, earnings ignore coupon allocation. **Done:** documented metric definitions, DB aggregates, distinct counts, paid/delivered/refunded filters and discount allocation; fixtures with >10 orders and mixed statuses match expected totals।

## P2/P3 — Content, reliability ও engineering gaps

- [ ] **AUD-035 (P2) — Contact form actual submission।** Evidence: `/contact` form has no action/onSubmit/backend and inputs lack submission names; sample phone/address presented as support details. **Done:** validated message endpoint, delivery/persistence, rate limit, success/failure feedback, verified business contact information।

- [ ] **AUD-036 (P2) — Newsletter actual subscription।** Evidence: `newsletter-bar.tsx` only sets local subscribed=true; no subscriber record/mail provider; promises $20 coupon. **Done:** persisted consent/subscription, provider failure/duplicate/unsubscribe handling, real coupon issuance or corrected promise।

- [ ] **AUD-037 (P2) — Deals, brands, recently viewed ও bestseller data truthful করা।** Evidence: `/deals` has fixed product names/prices/sold counts/countdown; `/brands` fixed counts; recently viewed/bestsellers receive the newest approved products rather than history/sales; currency selector only changes label. **Done:** DB-backed campaigns/brand counts, actual view history/sales ordering or accurate section names, one working currency policy; campaign expiry/inactive vendor behavior consistent।

- [ ] **AUD-038 (P2) — Avatar storage/validation এক করা।** Evidence: avatar multipart stores up to 5 MB as base64 DB text, accepts all `image/*`; JSON avatar branch and profile PUT bypass same media checks. **Done:** bounded approved media types/signature/URL checks, storage-backed references, rate limits and previous-object cleanup; malformed/oversized requests consistently rejected across both routes।

- [ ] **AUD-039 (P2) — Profile/default address mutation atomic করা।** Evidence: profile user update occurs before separate address writes; concurrent findFirst-then-create can make multiple defaults, schema has no default uniqueness enforcement. **Done:** transaction + consistency constraint/locking strategy; invalid address leaves user unchanged; concurrent saves keep one default।

- [ ] **AUD-040 (P2) — Runtime configuration contract এক করা।** Evidence: env schema accepts 16-character JWT secret while signing requires 32; requires unused NextAuth settings; treats Redis optional while production rate limiter denies every protected request without Redis; proxy has fallback secret unlike auth helper. **Done:** one required runtime schema with consistent secret length, fail-fast production service requirements, no fallback signing/verification secret; configured deployment boots and login works; health distinguishes readiness from simple liveness (`/api/health` currently always OK)।

- [ ] **AUD-041 (P2) — Trusted proxy/origin boundary deployment অনুযায়ী করা।** Evidence: rate-limit IP extraction unconditionally trusts `cf-connecting-ip`/forwarded headers, so direct origin access may spoof limiter identity; serverActions allowedOrigins includes wildcard tunnel domains. Deployment configuration not inspected remotely, so exploitability is conditional. **Done:** restrict ingress to trusted proxies or sanitize headers, per-account throttles, exact production allowed origins; verify direct-origin bypass is blocked।

- [ ] **AUD-042 (P2) — Query limits, error states ও operational observability।** Evidence: homepage/products/admin/seller dashboard read unbounded records; several DB catches render empty catalog/404 instead of service failure; health endpoint never checks DB readiness. **Done:** server pagination/bounded homepage selections, explicit unavailable/retry state, useful correlated logs and readiness probe; DB outage not reported as a healthy empty store।

- [ ] **AUD-043 (P2) — SEO domain ও product structured data correct করা।** Evidence: sitemap/robots use `amar-gadget.com`, schema fallback `amargadget.com`, README demo another host; sitemap has only home. Product schema ignores passed stock when determining availability, offer URL points to site root. **Done:** one configured canonical origin, approved-visible catalog sitemap, correct product slug/stock/canonical/noindex private flows; test actual exported route output, not only unused factories।

- [ ] **AUD-044 (P2) — Integration/browser tests ও CI gate।** Evidence: 17 current tests cover typography, metadata helper, mocked product/auth actions; no checkout/OTP/Stripe/real-adapter tests, no `.github` workflows. **Done:** disposable DB migration/seed smoke, transaction rollback/concurrency, role/ownership matrix, coupon quote, signed webhook duplicate/expiry/cancel tests; browser checkout cancellation/upload/critical navigation, CI build/type/lint/test gates; test-only services and fixtures।

- [ ] **AUD-045 (P2) — Existing lint debt ও broken hydration helper।** Evidence: ESLint currently 109 errors/71 warnings; `useHydratedStore` in `stores/cart-store.ts` calls a Zustand hook from useEffect, violating hook rules, and captures no live subscription. Current cart/checkout import but do not invoke it. **Done:** resolve actual hook defects, remove/replace unused broken helper, appropriate hydration strategy, no blanket lint suppression; changed files lint clean first, then repository baseline fixed।

- [ ] **AUD-046 (P3) — Placeholder/legal pages, 501 contracts ও README reconcile।** Evidence: `/privacy-policy`, `/terms`, `/verify-email`, `/order-success` are text-only; `/unauthorized` minimal; customer portal returns 501 (billing portal is optional for one-time checkout). README overstates bcrypt, full CRUD, compare, synced wishlist, verified reviews, streaming/performance claims and uses outdated test/lint results. **Done:** truthful implemented/planned matrix, useful public pages/redirects/error UX, optional billing portal removed from advertised scope or configured, setup matches actual adapter/PostgreSQL requirements; no unverified performance or production-ready claims।

- [ ] **AUD-047 (P2) — Media public URL/config ও lifecycle complete।** Evidence: presign helper returns uploadUrl/fileKey but no public URL mapping; R2_PUBLIC_URL is not used by helper; `lib/cloudflare/delete-file.ts` is an empty export; Next Image remotePatterns allow r2.dev but not a configured custom CDN host. **Done:** resolve keys through configured public base, validate custom CDN host in image policy, ownership-aware object cleanup on replacement/deletion, no accidental removal of another seller's assets; custom-domain R2 end-to-end test।

- [ ] **AUD-048 (P2) — Legacy payment/product helper consolidation।** Evidence: `lib/db-actions.ts` has a second checkout function using undiscounted price, `status: PAID` with default paymentStatus UNPAID and no availability/quantity validation; no call site found. Two product creation actions have different schemas/admin autoapproval behavior; existing product-action tests exercise the alternate action, not the seller form's full happy path. Stripe helper files include empty exports. **Done:** remove unused paths or consolidate on one validated flow, update tests to actual entry points, keep no callable/accidentally reusable unsafe payment path. The legacy helper is not claimed to be an exposed exploit।

- [ ] **AUD-049 (P2) — Database invariants ও rollout rehearsal।** Evidence: role/order/payment/status fields are unrestricted strings, Review lacks user/product uniqueness, Address lacks single-default invariant, trackingNumber is not unique, and relation/filter fields largely lack explicit indexes. Both migrations checked in but not applied in this audit. **Done:** document permitted transitions/constraints and deletion retention, add reviewed constraints/indexes for actual query plans, rehearse fresh install and existing-data upgrade on disposable DB including duplicate/invalid data handling; no automatic production migration from this report।

## Placeholder route coverage

এই তালিকার প্রতিটি page source-এ একটি text-only `<div>` return করে। কিছু বাস্তব feature অন্য route/tab-এ আছে, তাই page placeholder মানেই পুরো backend অনুপস্থিত বলা হয়নি।

| Routes | Follow-up |
| --- | --- |
| `/verify-email`, `/unauthorized` | AUD-046 |
| `/admin/banners`, `/admin/brands`, `/admin/categories`, `/admin/coupons` | AUD-027–029 |
| `/admin/members`, `/admin/users`, `/admin/reports` | AUD-030 |
| `/admin/notifications`, `/user/notifications` | AUD-033 |
| `/admin/reviews`, `/member/reviews`, `/user/reviews` | AUD-024 |
| `/member/analytics`, `/member/earnings`, `/member/payouts` | AUD-032 |
| `/member/orders`, `/member/products` | AUD-031 |
| `/user/addresses`, `/user/wishlist` | AUD-021–022 |
| `/compare`, `/search` | AUD-020 |
| `/order-success`, `/privacy-policy`, `/terms` | AUD-046 |

## বাস্তব implementation order

1. AUD-001–003: transaction foundation, unsafe JSON-LD ও public visibility।
2. AUD-004–017: safe auth/payment/inventory/upload foundation; disposable DB integration coverage পাশাপাশি।
3. AUD-018–026: browsing → quote → address → checkout → tracking/review complete journey।
4. AUD-027–034: admin/seller operating features, fulfillment/settlement requirements অনুযায়ী schema changes।
5. AUD-035–049: truthful storefront, reliability/config, CI/lint, media/legacy/schema cleanup, SEO/documentation।

প্রত্যেক implementation PR-এ task ID, code change, validation evidence ও remaining limitation রাখুন। UI-only success state দিয়ে backend task complete দেখানো যাবে না। Schema changes migration review করে disposable DB-তে পরীক্ষা করতে হবে; এই audit কোনো migration apply করেনি।

## Footprint ও পুনরায় যাচাই

- Audit report: this file; baseline and work branch recorded above.
- Diagnostic: [scripts/audit-offline.mjs](../scripts/audit-offline.mjs), no credentials or network calls.
- Generated evidence: [route inventory](audit-route-inventory-2026-10-28.json), regenerate with `node scripts/audit-offline.mjs`.
- Commit trailer: `Assisted-by: OpenAI Codex`; repository owner remains normal Git author. No fabricated screenshots, customer metrics or test results.
- Review branch diff against baseline: `git diff 37a80a8...codex/deep-audit-2026-10-28`.

### Final validation note

`npm run build` completed with exit 0, using `DATABASE_URL=postgresql://audit:audit@localhost:5432/audit`, `SKIP_ENV_VALIDATION=true`, and telemetry disabled in that command's process environment. No database query was intentionally executed; dynamic route generation does not validate checkout/OTP runtime behavior. No real credentials are recorded here. Docker image build was not run.

`npx eslint scripts/audit-offline.mjs`, `node --check scripts/audit-offline.mjs` and `git diff --check` passed for the audit contribution. The generated inventory was compared with a fresh diagnostic run. Existing repository-wide lint failure remains open under AUD-045. **49 open tasks** are listed; this branch implements the audit artifacts, not those fixes.
