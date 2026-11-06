# Verified purchase reviews and moderation

AUD-024 implements the previously empty review form and customer/seller/admin pages, authenticated review writes, actual public feedback and reconciled product ratings. This document describes the implemented policy and its verification boundary. It is not a production deployment, external-provider certification or release approval.

## Eligibility and ownership

A current verified account may submit one canonical review per product after an order item belonging to that account is DELIVERED and PAID. COD delivery already marks the order PAID through the authorized order transition; an unpaid reservation or undelivered order does not qualify. The server chooses the qualifying order item. Customer input cannot select an owner, order item, publication status, moderator or aggregate. A seller cannot review their own product even if an own-store purchase exists.

All private requests require the actual session and matching `X-Review-Owner`. This header is a queued-request precondition, not authority to select another owner. Writes recheck verification, role and session version under the User lock. Admin moderation requires the current ADMIN role. Seller reads require the current approved MEMBER account and filter to products actually belonging to it. A copied revoked session, stale account header or changed role cannot obtain a fresh private result or commit a review decision.

Purchase-based mutations lock the existing Order before User, Product and Review. This coordinates with payment/refund code and prevents publication from racing a change to the qualifying order. Review version preconditions reject competing edits/decisions visibly. The SQL partial unique index independently enforces one canonical row per user/product. A repeated uncertain create cannot produce another canonical review; reload the saved record rather than automatically replaying a different intent.

## Review states and consent

| State | Meaning and permitted action |
| --- | --- |
| LEGACY | Historical feedback without verified purchase provenance. Private, retained and excluded from ratings. Its canonical owner may explicitly resubmit after eligibility verification. |
| PENDING | New or edited purchase feedback awaiting moderation. Owner can edit/withdraw; administrator can publish/reject using its observed revision. |
| PUBLISHED | Approved canonical feedback associated with an eligible purchase. Public reads, seller feedback and aggregates include it. Owner editing sends it back to PENDING. |
| REJECTED | Private feedback with a required moderation reason, actor and timestamp. Owner can edit/resubmit; administrator can reconsider a submitted canonical purchase review. |
| WITHDRAWN | Owner removed the review from publication/moderation. Private record is retained. An administrator cannot republish it without owner resubmission. |

New and edited reviews do not appear publicly until approved. Editing a published review atomically removes its old rating/count contribution while the new version awaits moderation. Rejection removes a published contribution and stores a bounded reason visible to the owner. Withdrawal is a versioned soft transition; UI confirmation is required and private history remains available. Publication/rejection records the latest moderator ID, timestamp and reason on the row; this is not a separate immutable full edit-history ledger.

Scores are whole numbers from 1 to 5. Comments are optional plain text, trimmed and bounded to 2,000 characters by application validation, with non-text control characters rejected. A rating-only review is labelled as such instead of inventing a comment. Moderation rejection reasons are required, plain single-line text and at most 300 characters. Strict bodies reject extra owner/provenance/state/price fields. SQL constraints independently guard score/content/state, version, canonical/provenance and moderation metadata. A purchase trigger checks actual user/product association and delivered/paid state when submitting or publishing.

## Public presentation and aggregates

Only published canonical reviews with current delivered/paid purchase eligibility are returned publicly. Public product visibility still requires approved product and seller. Public DTOs contain review text/rating, timestamps, a first-name display label and verified-purchase indication. They omit account IDs, emails, avatars, shipping/contact data, order-item IDs and internal moderation fields. The shared public product reader applies the same publication filter and emits only selected public fields.

Product detail server-renders the actual first review page, with client pagination, refresh and explicit unavailable/retry state. A review-query failure does not become a successful zero-review claim. Plain review text is rendered as React text with whitespace preserved, so markup-looking feedback cannot become executable HTML. The review form uses the real account eligibility endpoint; signed-out/unverified accounts get a sign-in prompt, and no default five-star review is selected. Product cards, best-seller fallbacks and detail headings no longer invent five-star ratings for unrated products.

Publication, rejection, withdrawal and edits that remove a published contribution recalculate Product.rating/reviewCount under the Product lock and increment reviewVersion in the same transaction. Count/average use the actual published eligible rows, not submitted client values or seeded metrics. If the aggregate write fails, the review decision, revision and moderation metadata roll back together. Post-commit cache invalidation failure cannot turn a saved decision into a false write failure.

Public count/average/page rows are read in one repeatable-read transaction. Pages contain at most 20 reviews with deterministic creation/ID ordering. Page parameters are bounded and nonexistent pages fail explicitly; no silent first-fifty truncation remains. When browsing a later page after the publication version changes, the client loads the new first page rather than combining inconsistent snapshots. Owner, eligible-product, moderation and seller lists also use bounded pages and actual counts; eligibility lists deduplicate products across repeat purchases.

The current order model has order-wide delivered/paid state. AUD-014/AUD-015 must integrate per-item fulfillment/refund policy with this eligibility definition, public selection and `reconcileProductReviews` when those features are implemented. This contribution does not claim a partial-refund policy or a delivered-item model that does not yet exist. The reconciliation helper requires the Product lock and uses actual purchase association and current eligibility; financial changes must retain the documented Order-before-User-before-Product lock direction.

## Account-safe UI and role pages

`/user/reviews` provides own history, read-only historical duplicates, eligible purchases and an actual selected-product editor. `/admin/reviews` provides status-filtered moderation with revision-bound publish/reject operations and reason validation. `/member/reviews` shows published feedback for that seller's catalog, without moderation controls. Role-specific links are present in desktop/mobile account menus, and the product editor links to the owner's purchase-review history.

Private resources are keyed by account/role/seller scope, URL and refresh revision. Account transitions unmount prior drafts, abort readers/writers and reject obsolete replies even if HTTP ignores abort. Same-ID role changes also invalidate captured scope. Owner preconditions are checked again by the server against the actual cookie. A failed/uncertain save preserves typed rating/text/rejection reason; reload is explicit and labelled as discarding unsaved edits. The UI never labels a failed list as an empty list. Form writes prevent duplicate in-flight submissions and bound request deadlines.

## Historical data and migrations

`20261030100000_verified_reviews` retains every existing Review as LEGACY without inventing an order-item association. For an existing duplicate user/product group, the newest creation time and then descending ID determines its one canonical row. Other duplicates remain private read-only records with their original score, text and timestamps. Invalid historical ratings or oversized old comments are retained as legacy data. The owner must choose a valid score and explicitly review/shorten text before resubmission; the editor does not truncate it or fabricate a five-star replacement.

Historical Product.rating/reviewCount values have no proven publication lineage and are reset to zero. New aggregates come from approved purchase reviews. The migration adds provenance, state/revision/moderation constraints, a verified-association trigger, the partial canonical uniqueness guard and review/order-item read indexes. Existing linked order items are retained through a restrictive foreign key. `20261030110000_review_listing_indexes` adds indexes for seller-product reads and order-to-item eligibility joins. Prisma represents ordinary indexes; the partial canonical index and custom checks/trigger remain reviewed SQL invariants rather than a misleading full `@@unique` declaration.

Review the data and back up the intended database before the approved schema/application rollout. Index creation and aggregate reset may lock or scan existing tables, so select an appropriate maintenance window for a large dataset. Run the isolated migration rehearsal first; do not reset production to adopt the feature. Runtime readiness requires both migrations. No production database or provider configuration is changed by these tests or this contribution.

## API contracts

| Route | Contract |
| --- | --- |
| `GET /api/reviews?productId=…&page=…` | Published eligible public feedback, actual count/average/version and bounded page; approved public catalog only |
| `GET /api/user/reviews?productId=…` | Current owner's canonical review, real purchase eligibility and explanation |
| `GET /api/user/reviews?tab=mine|eligible&page=…` | Current owner's retained history or distinct eligible products not already canonically reviewed |
| `POST /api/user/reviews` | Strict product ID, rating and optional nullable comment; creates one verified PENDING review |
| `PUT /api/user/reviews` | Owned canonical review ID/version and content; re-verifies purchase and returns to PENDING |
| `DELETE /api/user/reviews` | Owned review ID/version; withdraws a submitted review without deleting history |
| `GET /api/admin/reviews?status=…&page=…` | Current administrator's scoped moderation queue; retained legacy records are read-only |
| `POST /api/admin/reviews` | Review ID/version plus publish/reject; rejection requires a reason |
| `GET /api/member/reviews?page=…` | Approved seller's own published purchase feedback; no customer/moderation mutation authority |

Private endpoints require the expected-owner header. Responses use private/no-store and the existing private-route noindex protection. Bodies are bounded before JSON allocation: 8 KiB for review content, 1 KiB for withdrawal and 2 KiB for moderation. IP/account request budgets apply; public reads are also limited. Query fields are strict and duplicate selectors fail. Session/rate/input/conflict/unavailable responses remain distinguishable, without returning database exception details or fake empty results. The existing signed-ingress and Origin policy remains required.

## Reproduction and evidence

Use a disposable local `audit_*` PostgreSQL database; the test harness rejects external hosts and query overrides. The reviewed migration was applied to a new local fixture named `audit_amar_gadget_reviews`. Earlier fixture databases are not production targets and were not reset to adopt this work.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://codex_audit@127.0.0.1:55439/audit_amar_gadget_reviews'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_URL = $env:TEST_DATABASE_URL
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npm run build
npm run smoke:reviews
npm run smoke:cart
npm run smoke:seo
git diff --check
```

SQL/handler tests exercise delivered/paid eligibility, strict ownership/provenance, self-review denial, one-per-product concurrency, actual averages, edit/moderation revisions, withdrawal consent, legacy quarantine, private product serialization, visibility, rate/body/input bounds, SQL constraints, aggregate-write rollback, real moderator lock-wait revocation and pages beyond the first 20 records. A fresh disposable database rehearsal preserves duplicate/invalid legacy records and original timestamps, clears unsupported aggregates and verifies the new constraints, association guard, retention and indexes.

Client/DOM tests mock only HTTP/storage/session boundaries. They verify actual mounted submit/edit/withdraw/moderation/seller/customer/public views, draft retention, explicit confirmation, old account/role result rejection, request deadlines, publication page consistency, escaped feedback and unrated-card truth. These deterministic tests are not an interactive browser walkthrough.

The prepared-server smoke uses actual authenticated HTTP and SQL. It creates an account cart, invokes compiled COD checkout, verifies ineligibility before delivery, invokes the real administrator delivery action and then exercises actual review submission, publication, edit, stale moderation, rejection, resubmission, withdrawal and legacy refusal. It checks rendered escaped product feedback, seller isolation, private role pages, expected-owner/Origin/ingress guards, noindex/no-store headers and copied-session revocation. It uses local test records and does not represent a real shipment, hosted card charge or production moderation decision. Browser/provider/release certification remains AUD-044; SMTP credential revocation remains AUD-051 until confirmed by the owner.
