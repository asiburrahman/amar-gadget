# Contact submissions and administrator support handling

AUD-035 includes contact submissions, administrator handling and dashboard-managed public contact details. The owner enters and publishes actual business information through settings; no fixed contact values or credentials are required in source code. See [exact verification evidence](SUPPORT_IMPLEMENTATION_NOTES.md). No production rollout has occurred.

## Manage public business contact details

Open **Admin Settings → Manage public support contact details**, or `/admin/settings/support`. The support inbox links the same screen. Enter the support email, telephone number, business address and support hours/timezone you want to disclose. Blank fields are omitted; no sample business values are seeded. These fields are public contact information, not SMTP settings or account credentials.

Save an unpublished draft while preparing information. To publish, enable **Publish these contact details**, confirm accuracy/public disclosure and enter a change reason. At least one detail must be present. The Contact page and homepage footer show the current published database revision on subsequent requests. Disable publication to hide all details, or clear individual fields and save to remove them. Hiding the details does not disable the working contact form.

The editor retains the revision you reviewed and your typed draft during a refresh. **Load latest into editor** explicitly adopts saved values; a stale save cannot overwrite another administrator's change. Every save retains immutable before/after, actor, reason and publication verification evidence. History uses real 20-record pages. Tab-local exact intent/receipt recovery protects lost responses and repeated saves. Current administrator authority is rechecked for each read/write; private drafts and history are never returned to public components.

## Public receipt

`/contact` posts strict bounded JSON to `/api/contact`. The message must include a name, contact email, allowed topic, subject, at least ten characters of message and explicit storage consent. An order reference is optional sender-provided text; it does not validate order ownership or grant access to customer/order data. No attachments or account/payment credentials are requested. Storage permission does not enroll the sender in newsletters.

A successful receipt contains only the submission's random reference and database-recorded receipt time. It confirms durable PostgreSQL storage for administrator review. The form does not claim an email was sent, a response deadline was met or a warranty/order action was authorized. The unverified sample phone/address/email details and 24/7 claim have been removed from this page.

Before sending, the form saves the exact intent in the browser tab's session storage. Its contact/message fields are locked while receipt is uncertain. Network timeouts, non-JSON failures and unavailable responses retain the same reference/body for retry, including across reloads. Exact retries return the same receipt without a duplicate message. Conflicting reuse cannot rewrite original content. A confirmed schema/content-type/size rejection allows editing the rejected message. New sends are blocked if the original intent cannot be safely stored; corrupt saved metadata is not silently discarded.

After confirmed receipt, the tab replaces the private intent with its minimal receipt. **Write another message** explicitly clears that confirmed local receipt. If that local replacement/clear fails, keep the receipt and recover the original operation before starting another send. No public list/detail endpoint exposes saved messages.

## Administrator processing

Open `/admin/support` through administrator navigation. Each queue/detail/status request requires a current verified administrator session and the current viewer's identity header. Current database role/session is rechecked under a lock for each transaction. Revoked sessions, demoted accounts and other roles cannot read sender details or alter status.

The queue uses actual 20-record pages, status/topic filters and whole-queue state counts. Lists show subjects/references rather than copying sender contact details into every row. Open an inquiry to view the original sender/message, storage consent timestamp, current saved status and paginated history. Treat the optional order reference as unverified text. Verify any order/customer authority through the established private order workflow.

Statuses are OPEN, IN_PROGRESS and RESOLVED. Review the saved revision, choose a different status and provide a reason. Resolution records internal handling; it does not send email. Reopen an inquiry explicitly when further review is required. Use your approved external support channel for any customer response, without recording credentials or unnecessary private information in the reason.

Each status change stores append-only actor, before/after state, reason, revision and server timestamp evidence. The exact decision identity is saved in administrator-scoped tab storage before submission. Lost responses can be retried unchanged after reload and return their original receipt without another event. Refreshing details does not silently replace the revision captured for a decision. Stale competing changes fail; a confirmed rejection can be cleared and reviewed again. An uncertain decision remains locked for exact retry. Account changes abort private work and remove cached sender content; failed reads do not invent a healthy empty queue.

## Database and request boundaries

Migration/readiness target: `20261103150000_support_contact_settings` (migration 34). Migration 33 adds message, status-evidence and operation-receipt tables; migration 34 adds dynamic public contact settings and publication history. Neither backfills inquiries, publishes sample contacts or sends messages. Original contact/message/consent content and receipts are immutable, and ordinary deletion is refused to preserve the support/audit record. Account removal does not cascade-delete operator evidence. Retention/deletion policy changes require a separately reviewed operator procedure/schema change; do not bypass guards as routine queue maintenance.

Status changes require the next revision and matching event. A deferred constraint prevents an orphan event from committing without its state update. Actual business failures roll back both. Submission and administrator operation identities serialize concurrent exact retries, and normalized-content digests reject conflicting reuse. Digests are not public lookup credentials.

The public endpoint requires JSON and limits decoded input to 48 KiB, messages to 8,000 characters, IP requests to five/minute and normalized-contact requests to three/ten minutes. All requests still pass the application's trusted-ingress/origin policy. Contact limiter keys are hashed; Redis/database outages are not presented as successful persistence. Administrator inquiry writes have a 4 KiB decoded limit; contact-settings writes use 8 KiB. Both have bounded rate/transaction/statement/lock waits. Responses are private/no-store and errors/logs omit contact text, credentials and raw database diagnostics. Shared Prisma automatic query/error diagnostics are disabled so they cannot bypass the handler's redaction.

## Local verification

Use a disposable local `audit_*` database; never point these checks at production:

```powershell
npx prisma migrate deploy
npx prisma generate
npx jest --runInBand
npm run build
npx tsc --noEmit
npx prisma validate
npm run smoke:support
```

Run TypeScript after the build has finished generating route types. The native smoke creates/migrates its own fresh database, boots prepared standalone output with isolated Redis/ingress credentials, uses actual password login/cookies and compiled HTTP routes, then closes only its owned fixtures. It covers actual anonymous persistence/exact replay, private role scopes, internal status/history, stale conflicts, a real PostgreSQL failure, role revocation and rendered server pages. Automated UI and local provider fixtures do not replace interactive-browser/hosted-provider release verification under AUD-044.
