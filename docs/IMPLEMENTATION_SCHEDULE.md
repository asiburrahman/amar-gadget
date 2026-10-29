# Implementation sequence and completion rules

Requested by Asibur Rahman on 28 October 2026: finish the remaining audit work carefully, in small steps. Do not compress the scope, replace working features with demos, or label unverified behavior production-ready. Continue routine reversible work without repeated approval requests. Ask for business rules or external-service access only when that specific step needs them.

This is a dependency-ordered work queue, not a background timer or a promised completion date. Each active session takes the next task through implementation, relevant validation, documentation and GitHub commit/push. All work stays on `codex/deep-audit-2026-10-28`; main is not merged automatically.

Standing owner instruction after AUD-007: complete **all remaining 40 tasks**, one at a time, preserving every task's scope, with a focused professional commit and push for each. Session checkpoints do not narrow that objective or require a fresh permission request to continue routine authorized work.

New findings are additive, not replacements for that scope. The dependency scan during AUD-008 identified urgent AUD-050; see [additional audit findings](ADDITIONAL_AUDIT_FINDINGS.md). It is prioritized immediately after AUD-008, before continuing account-security work.

AUD-009 delivery tracing also found tracked SMTP fallback credentials (AUD-051). The code hotfix is separate; the task stays open for the account owner's credential-revocation confirmation. Independent original work continues while that external action is pending.

| Phase | Tasks, in working order | Outcome |
| --- | --- | --- |
| 1 — Completed foundation | AUD-001, 002, 003, 012, 013 | Transactions, JSON-LD safety, visibility and seller data/state guards |
| 2 — Checkout reliability | AUD-004 → 005 → 006 → 007 → 025 → 026 | One order per attempt, bounded stock reservations, payment retry, correct quotes and tracking |
| 3 — Account security | AUD-008 → 050 → 009 → 010 → 011 → 039 → 040 → 041 | Password/OTP/session protections, dependency security patches, atomic profile updates, runtime/proxy boundaries |
| 4 — Catalog and media | AUD-016 → 017 → 018 → 019 → 020 → 037 → 043 → 047 → 048 | Real uploads, validated product mutations, browsing/search/compare, truthful data and SEO |
| 5 — Customer account | AUD-021 → 022 → 023 → 024 → 038 | Address selection, wishlist/cart persistence, verified reviews, avatar storage |
| 6 — Marketplace operations | AUD-014 → 015 → 032 → 034 | Per-vendor fulfillment, refunds, settlement and accurate financial metrics |
| 7 — Administration | AUD-027 → 028 → 029 → 030 → 031 → 033 | Complete catalog/promotions/user/report/vendor management and notifications |
| 8 — Communication and content | AUD-035 → 036 → 046 | Delivered support messages, real subscriptions, completed public pages and truthful documentation |
| 9 — Release verification | AUD-042 → 044 → 045 → 049 | Query/error reliability, integration/browser/CI coverage, lint, schema constraints and migration rehearsal |

Cross-cutting tests, migration validation, error handling and accessibility belong to each task; they are not deferred to phase 9. Earlier phases may discover additional requirements, which must be recorded instead of silently dropped. Financial policy (commission, payout approval and refund rules) will be clarified before implementing those operations.

## Definition of completion

1. Trace the actual frontend → action/API → database/provider path and implement its normal, failure, authorization and retry behavior.
2. Keep simulated providers, fake success messages and demo records out of application behavior. Controlled test fixtures and mocks are permitted **only in tests**, clearly distinguished from real integration checks.
3. Add reviewed migrations for schema changes; apply them to an isolated local database first. Do not apply to production or deploy without an explicit rollout step.
4. Run checks proportionate to the risk: relevant unit/integration tests, TypeScript, affected-file lint and build when warranted. For external integrations, record configuration and verification still needed.
5. Update the [implementation log](CODEX_IMPLEMENTATION_LOG.md) with task status, evidence, commit links and limitations. Push a focused commit with `Assisted-by: OpenAI Codex`.
6. Do not declare the whole application production-ready until the release checks and actual configured provider/browser flows have passed.

## Current task

**Latest fully completed step: AUD-017 — bounded catalog/media/price validation and current administrator mutation guards.** Current total: 20 original tasks plus AUD-050 implemented (21 of 51 tracked tasks); 29 original tasks plus AUD-051's external credential revocation open (30 total). **Next: AUD-018 — consistent brand slug/ID filtering across links, product page and API.** On 29 October 2026 the owner confirmed revocation has not yet occurred; source remediation does not perform that provider action. The full remaining-task objective stays active across checkpoints. Each task remains a separate implementation and commit. See the implementation log and ingress/media runbooks for evidence, required private gateway/CORS/maintenance deployment, residual low registry alerts and external verification.

## Owner-provided introduction

Asibur completed graduation approximately four years before this conversation, is not a student, currently does programming using Codex and other platforms, and has completed several web-development projects. Do not invent an employer, degree subject, audience size, customer metrics or professional title beyond this supplied information.
