# AUD-033 implementation checkpoint

Status: **implementation and local verification complete; production rollout not performed**. See the [final notification operator runbook](NOTIFICATIONS_RUNBOOK.md). These notes preserve the initial foundation checkpoint; its pending lists and fixture/readiness statements below describe that earlier checkpoint, not the final state.

## Delivery and audience contract

This task implements in-app inbox delivery. It does not promise an additional email channel or use SMTP credentials. Durable source capture covers seller applications/decisions, account access changes, product review/decisions, orders/payment, owned shipments, refunds/disputes, payouts and future commercial policy changes. Freeform operator evidence, credentials, addresses and external payment references are not copied into payloads.

- ACCOUNT messages belong to the captured account, including a seller/administrator purchasing as a customer. They remain personal across later role changes.
- SELLER messages belong to a captured seller/owner or the immutable seller assignments on the order. MEMBER/ADMIN accounts can read their own seller audience. A blocked/pending seller may read their own account-decision notices after establishing a current session; catalog/payout restrictions remain separate.
- ADMIN messages are fanned out to current verified administrators during bounded delivery. Only the current ADMIN role can read that audience. Former administrators cannot view or mutate those old private notices through a USER session.

Every inbox additionally requires the exact current owner ID, verification, role and session revision from PostgreSQL. No client role/recipient selection authorizes a read or write. Source-resource destinations are generated from known internal routes, never a payload URL.

## Implemented database/source foundation

Migration 32, `20261103120000_notification_outbox`, was applied to newly isolated test databases and is **frozen**. Corrections to applied SQL require a new migration. At this foundation checkpoint the primary local application fixture remained on migration 31; the final verified implementation advances readiness to migration 32.

Actual source triggers atomically enqueue immutable NotificationEvent content with a unique source identity. Identical enqueue retries deduplicate; conflicting content under the same identity fails. A rejected business transaction rolls its queued events back. No old source events are backfilled as newly delivered notifications. Existing source/purchase history is preserved through the migration rehearsal.

Notification rows bind their content, audience, recipient and occurrence time to an actively leased source. Direct, administrator, captured-order-seller and verified catalog-owner recipient scopes have database guards. Delivered content cannot be rewritten; read state requires its next revision and server UTC time. Deletion with a removed parent account follows the explicit account cascade; unrelated deletes cannot remove delivered content. Event and administrator retry evidence is retained.

## Implemented worker and inbox services

The worker claims due events with SKIP LOCKED, a unique 30-second lease and current revision. A stale/expired token cannot deliver or overwrite a replacement claim. Delivery inserts at most 100 recipients per transaction with a unique event/account key. Inbox inserts and cursor advancement commit together. Successful partial pages reset consecutive attempts; large fan-out does not exhaust the failure limit merely by making progress. Source removal/no recipients is recorded as SKIPPED, never falsely DELIVERED. Failed inserts roll back and use bounded exponential retry; eight unconfirmed attempts become DEAD. Invalid immutable event data is quarantined. The sweeper bounds both event count and runtime.

Recovery tests exposed a six-hour raw timestamptz mapping offset in the installed Prisma adapter under the Dhaka host timezone. Lease/retry Date arithmetic now reads an explicit UTC timestamp matching the database columns. PostgreSQL epoch assertions prove a real approximately 30-second lease and immediately due administrator requeue, rather than accepting an accidentally hours-long delay.

The scoped inbox service provides real 20-record pages, kind/read filters, whole-scope unread counts, naturally idempotent read changes and observed-revision checks for reversals. A stale or mixed-ownership read-page request changes nothing. The administrator queue service shows actual state counts, stored message counts and safe failure codes. Explicit, reasoned retries requeue only eligible RETRY/DEAD/no-recipient events, preserve checkpoints, respect active claims and append audit evidence; repeated identical state decisions do not create duplicate retry records.

## Current verification and remaining work

Five focused suites pass **20 tests**, covering actual PostgreSQL source capture, no-backfill upgrade, privacy/deduplication/rollback, source/lease/recipient binding, large fan-out, concurrent/expired leases, real insert failure recovery, bounded retries/quarantine, exact scoped unread/read state, stale/foreign batches, current-session/role changes and audited administrator recovery. TypeScript, Prisma schema/client generation and affected-file lint passed during foundation work; a final full suite/build has not been run for AUD-033.

Still required: replace the 501 notification endpoint; add private administrator queue/retry and authenticated worker delivery handlers; package the guarded worker/cron operation; implement admin, customer and seller inbox pages/navigation with real unread/read interactions and queue recovery; test UI failure/account changes and HTTP ownership/limits; run production build and prepared native HTTP/compiled-flow smoke; complete final migration/status/regression checks and operator runbook/task log; commit/push the complete AUD-033 separately. The full remaining audit objective stays active.
