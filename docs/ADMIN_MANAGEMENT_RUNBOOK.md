# Administrator accounts, analytics and reports (AUD-030)

Pages: `/admin/users` for every registered account, `/admin/members` for seller accounts, `/admin/analytics` for all-time database counts and `/admin/reports` for filtered order cohorts/CSV. The retained `/admin/sellers` URL redirects to the member directory. MEMBER means seller; USER means customer. Directory product counts, purchases made as a customer and seller shipment counts are labelled separately.

## Account operations

The directory supports bounded name/email/exact-ID search, role, seller-status and verification filters with 20-row pagination. Select an account, load its current revision when needed, choose a different role/seller status or revoke sessions, record a single-line reason (5–300 characters) and explicitly confirm that account/revision. Changing the decision or reason clears confirmation. Ordinary list reloads preserve an open draft rather than silently rebasing its revision.

- Promotion to ADMIN requires an already verified account with sign-in credentials recognized by the actual password parser. Unsupported imported strings are not counted as usable credentials. An operator cannot demote the last verified administrator with supported sign-in credentials through these application entry points. Candidate metadata is checked in bounded pages without returning hashes to the client. Role decisions serialize before taking account locks, including competing self-demotions; at least one usable administrator is retained.
- Moving to MEMBER sets seller status PENDING, requiring a separate onboarding approval. Moving to ADMIN sets APPROVED. Moving to USER sets BLOCKED for the seller catalog, preserving products, purchases, captured seller shipment ownership and order history rather than deleting them. Existing fulfillment can still be managed by an administrator.
- Seller moderation applies only to MEMBER accounts. Approval requires completed verification and sign-in credentials. Pending, rejected and blocked sellers remain visible in the administrator directory; public catalog queries follow the existing approval gate.
- Each successful role/status/session action revokes current sessions for the target. Revoking sessions is distinct from disabling a customer's future sign-in. Password editing, verification bypass, customer banning and account deletion are not exposed as fictitious controls. Own role/session changes sign the administrator out after confirmed success; an uncertain own-account write requires a fresh sign-in to establish current authority.

Private `GET/POST /api/admin/accounts` requires a current verified ADMIN session, expected `X-Account-Owner`, strict fields, bounded JSON, IP/account limits, a random request UUID and the observed administration revision. Writes lock account IDs in stable order and recheck authority under the transaction. `POST /api/admin/sellers` retains its URL as an alias of the same canonical contract. The legacy server action also requires revision, request UUID, reason and explicit confirmation; its old two-argument mutation is rejected. The previous UI's automatic second mutation fallback was removed.

Exact retries read the original durable receipt and current account state; reuse with another owner/body is rejected. After an unconfirmed response, reload its original receipt before retrying the identical request or discarding unrecorded intent. Account switches abort old work and ignore late responses. Security history retains actor, reason, before/after access facts, monotonic sequence and UTC instant. Password/hash/OTP values are never included. Credential or verification/session changes from existing account workflows also invalidate an open administration draft; ordinary profile-name edits do not.

Last-administrator enforcement covers the supported application role-mutation paths. Private provisioning/operator SQL is an external privileged operation and must retain administrator access; the application does not pretend to constrain a database superuser.

## Analytics and report definitions

The analytics page and `/api/analytics` read counts in a current, authority-checked repeatable-read transaction. The existing root administrator statistics action uses the same overview. Registered accounts include unverified registrations; customer/seller/administrator counts follow actual current roles. Pending seller/product queues come from saved statuses. No fabricated growth percentage, uptime or system-health percentage is displayed.

Reports select orders by **placement date in Asia/Dhaka**, with both dates inclusive. Defaults are the latest 30 calendar days; explicit ranges permit at most 366 days. PostgreSQL performs calendar/timezone boundaries and daily grouping, including its historical timezone rules. Optional filters select order status, payment status, payment method and a customer/account UUID. Pagination and CSV use the applied filters, not an unsubmitted form draft.

Summary, rows and daily cohorts share one repeatable-read snapshot:

| Field | Meaning |
| --- | --- |
| Gross order book | Recorded totals including shipping, unpaid and cancelled orders; not earned revenue |
| Fully paid capture | Recorded total of orders whose payment status is PAID |
| Paid-order confirmed refunds | Confirmed refund counter on those paid orders |
| Paid-order lost disputes | Confirmed lost principal on those paid orders |
| Net fully collected | Paid total less confirmed refunds and lost principal, floored at zero per order |
| Partially collected COD orders | COD orders not fully PAID but with at least one collected shipment; excluded from the fully collected money total |
| Financial review | Recorded reservation/financial review, pending/review refund or active/lost dispute facts |

Refund/dispute facts are **current for the selected placement cohort**, not a statement of transfers made within the selected dates. This report is not a cash-flow ledger, commission or seller payout availability. AUD-032 separately implements the owner's dynamic commission/shipping allocation and external payout policy; no placeholder payout amount is represented as live money here. Account role changes do not remove earlier purchases from the order cohort.

All money is derived from actual persisted amounts/counters in integer cents with supported-range checks. UI and CSV format cents without losing the final paisa at the safe-integer boundary. Rows omit addresses, phone numbers, email and provider secrets; customer UUIDs let administrators correlate the account directory. Daily rows show dates with matching orders. Query failures retain a clearly dated prior report or show an explicit unavailable state, never invented zero totals.

## CSV and privacy

`GET /api/admin/reports` requires `X-Reports-Owner`; `/api/analytics` requires `X-Analytics-Owner`. These private responses are `private, no-store`; CSV also uses explicit content type, safe attachment filename and `nosniff`. IP/account limits and fresh authority checks apply. Duplicate/unknown filters, invalid dates, partial/reversed ranges and malformed identifiers are rejected.

CSV exports **all matching orders up to 5,000** from a fresh database snapshot using the displayed filters, regardless of the current UI page. Above that limit the server refuses the export and requests narrower filters; it does not silently return a partial dataset. Each row records the cohort dates and export time. UTF-8 BOM, quoted/escaped fields and formula-prefix protection support safe spreadsheet import. Export failures do not create a download or replace the prior report with zeros. Account changes abort pending reads/downloads and reject late completions.

## Migration and rollout

Migration `20261102120000_account_administration` adds the account administration revision, role/date/report indexes and append-only request/security history. Existing account credentials, roles, statuses, verification, session versions, creation dates and orders are preserved. Its security revision follows existing credential/session writers without requiring those paths to copy secrets into evidence. Readiness requires all 26 migrations. History begins with subsequent changes; past security changes cannot be reconstructed.

The migration was applied only to newly created local databases. Back up and review the real target before an approved rollout. Existing private operator tools remain privileged; never publish account credentials or change an already applied migration. No production migration/deployment, actual email, real payment or payout is performed by this task. Interactive-browser/configured-provider release verification remains AUD-044; external SMTP revocation remains AUD-051.

## Reproduction

Set `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL` to the same disposable local PostgreSQL database named `audit_*`.

```powershell
npx prisma migrate deploy
npx prisma generate
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
npx prisma migrate status
npm run build
npm run smoke:admin-management
npm run smoke:dashboard-metrics
npm run smoke:refunds
git diff --check
```

Financial/migration/native fixtures create fresh random local databases and drop only the database created by that invocation. Existing databases and earlier failed fixtures are preserved. PostgreSQL cases exercise actual role/revision/receipt/session/cookie behavior, competing self-demotions, credential-safe audit, retained products/shipments/orders, filtered pagination, timezone boundaries, actual COD refund and dispute facts, partial collection, concurrent snapshot consistency and oversized-export refusal. DOM tests explicitly replace HTTP boundaries to check real forms, original-intent recovery, confirmation invalidation, account-switch privacy, applied filters, exact formatting and export failure. These boundaries are distinguished from compiled-server actual HTTP login/routes/SQL and from interactive-browser or hosted-provider certification.

Recorded final checkpoint: **889 tests across 103 Jest suites pass** with isolated PostgreSQL enabled. The final root-dashboard precision regression also passes (10 targeted page/authorization cases), preserving the last paisa at the supported aggregate boundary. TypeScript, all changed-file ESLint (zero errors/warnings), schema validation, all 26 migration status checks, production build, runner syntax and diff checks pass. The final compiled administrator smoke exercises actual password login, expected-owner/private directory scope, last-admin protection, seller approval/block/public visibility, exact receipts, signed-cookie revocation, cohort JSON/CSV, real root/analytics/directory/report pages, retained seller URL redirect, role transitions/history/privacy and own-role demotion/copy-cookie denial. The runner honors `/api/auth/me`'s existing `200` with `success:false,user:null` contract and separately verifies protected cart denial. Existing compiled customer/seller metrics and refund/worker/manual-COD/inspected-return smokes pass as regressions.
