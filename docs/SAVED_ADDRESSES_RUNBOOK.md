# Saved shipping addresses and checkout

AUD-021 implements `/user/addresses` and connects the actual checkout form to private saved-address data. It builds on AUD-039's owner lock and partial unique default index. Historical audit descriptions are not current feature status; see the implementation log.

## Customer behavior

Customers can add, edit, remove and choose a default address. All shipping fields are explicit; no sample street, city or district is a submitted default. The first newly saved address becomes default. Later addresses become default only when requested. Deleting a default promotes the oldest remaining address, ordered by creation time then ID; deleting the last leaves none. Legacy accounts with saved rows but no default require explicit selection or manual entry rather than an invented default.

An account can create up to 20 saved addresses. Existing accounts above that limit remain readable/editable/deletable, with ten-row pagination; nothing is silently truncated or bulk deleted. Reduce the count below 20 before creating another. Creating a default through the profile endpoint follows the same cap. Text is trimmed and bounded: recipient 2–120 characters, valid phone 10–15 digits within 30 characters, street 3–500, city/district 2–100 and optional postal code up to 20. Control characters are rejected. Postal code may be omitted, empty or null in saved data; checkout submits a string. Legacy invalid addresses are preserved, but must be corrected before use in a new checkout.

Checkout prefills an untouched form from the saved default, permits another saved choice across pages, and supports manual entry. Selecting manual entry clears shipping location/postal fields; account name/phone may still prefill contact fields. A manual edit snapshots the displayed shipping values so late fetches and changed defaults cannot overwrite typing. Account transitions remount the draft and abort obsolete reads, preventing the prior account's selection from carrying over. An address fetch failure offers retry and manual entry; it never supplies demo data. While an initial default is loading, order submission waits unless the customer explicitly starts manual entry. Shipping/payment controls are frozen during submission.

Checkout sends the displayed shipping values, not an address ID or caller-selected owner. The existing authoritative checkout action still validates them, derives session/guest identity and prices, enforces stock and binds the attempt. This is an editable shipping snapshot: it does not silently update the address book. Editing/deleting saved rows afterward cannot change the committed order's shipping string/contact. Automatic saving of checkout entries, address geocoding, postal deliverability certification and commission/refund policy are not claimed by this feature.

## API and concurrency

`/api/user/addresses` requires the current verified session. Production ingress signatures and exact browser Origin rules remain enforced by the existing proxy. All successes/errors are private/no-store; API/personal flows retain noindex. Responses contain only the owner's shipping DTOs and revisions, without userId, session data or another account's rows.

| Method | Input | Result |
| --- | --- | --- |
| GET | Optional `page` integer 1–1,000,000; no other/duplicate query keys | Ten addresses, exact count/pages and actual default |
| POST | `{fields, makeDefault?}` | Create owned address, 201 |
| PUT | `{id, version, fields}` | Edit owned current revision |
| PATCH | `{id, version}` | Select owned current revision as default |
| DELETE | `{id, version}` | Remove owned current revision and promote a remaining default if needed |

Write bodies are strictly validated and limited to 4 KiB before JSON allocation. Foreign/missing IDs return 404; stale revisions/session changes return 409; invalid input 400, oversized bodies 413, exhausted IP/account budgets 429 with Retry-After, and unavailable storage 503. Read/write budgets are separate: reads 120/IP and 120/account per minute; writes 60/IP and 30/account per minute. Error responses do not publish database exceptions or address details.

All service reads/writes take the account's User row lock, then recheck current verified role/session before address work. Transactions have a ten-second bound, three-second row-lock wait and five-second pool acquisition wait. Concurrent creation cannot bypass the cap; concurrent edits require a current revision. Switching defaults first clears the old one and increments affected versions in the same transaction. The existing database partial unique index remains the final at-most-one-default protection. A failed insertion rolls back both the old default and its version. No cross-account administrative address override exists.

Migration `20261029130000_address_revisions` adds `Address.version` with default one and a positive check. Profile saves increment the same revision. The current profile editor sends `{addressRevision: {id, version}}`, or null when it observed no default, so a changed default/revision rejects the entire profile/address transaction rather than overwriting another tab's choice. Existing API clients omitting this optional profile precondition retain serialized last-write behavior; they receive no owner-selection permission. The saved-address CRUD API always requires current revisions for existing rows. On a conflict, reload addresses and explicitly reopen the latest row; a retained old draft is not silently reapplied. On an uncertain network save, reload before retrying, since address creation is not claimed to be idempotent across deliberate repeated POSTs.

## Verification and rollout

Use only an isolated local `audit_*` database via TEST_DATABASE_URL. Run the saved-address, migration, profile, checkout/quote/attempt and UI regressions, then TypeScript, affected-file lint and the production build. `npm run smoke:saved-addresses` starts the prepared standalone artifact with actual local SQL and authenticated sessions; it exercises private CRUD, ownership, Origin/ingress, defaults, profile conflict, stale revision, revocation and a compiled Next Action checkout using the selected address values. It verifies server pricing and an immutable order shipping snapshot after address deletion. It never prints private child output, cookie values or action encryption keys.

The integration tests use actual PostgreSQL for cap/default/edit races, owner-lock revocation, transaction rollback, profile coordination and order snapshots. A fresh disposable database applies all prior migrations, inserts legacy address data, applies the new migration and verifies preservation, revision default/check and default uniqueness. DOM tests explicitly mock HTTP/action boundaries to test visible prefills, choices, late responses, account changes, manual fallback, CRUD feedback/confirmation and draft retention. These are not a full real-browser walkthrough; that remains AUD-044. No provider operation is needed for address storage. The migration was applied only to the local audit database; production migration and deployment remain an operator rollout step.
