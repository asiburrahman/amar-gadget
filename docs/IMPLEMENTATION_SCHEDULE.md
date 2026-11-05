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

**Latest implemented step: AUD-045 - repository lint, UI lifecycle and browser locks.** Current total: 47 original tasks plus AUD-050 implemented (48 of 51 tracked tasks); 2 original tasks plus AUD-051 external credential revocation remain open (3 total). **Next: AUD-046 - public content, legacy routes and truthful documentation.** Remaining originals: AUD-046 and 049. SMTP revocation still requires the owner's external provider action. Each task remains a separate implementation and commit/push. All three CI jobs passed on 5912e80, including lint and PostgreSQL 16/18 verification. See the implementation log and release verification runbook; the complete remaining-task objective stays active.

## Completed AUD-042 checkpoint

Administrator products/orders, seller catalog, customer history and taxonomy choices now have real server pages and whole-scope search/counts. Public category browsing preserves descendant selection through independently paged choices/products. Financial reconciliation aggregates full histories rather than truncating them. Session/catalog/homepage failures have explicit recovery and safe log references; readiness verifies the required schema, enabled OTP clock guards, critical relations and Redis. Actual database/Redis/transport outages, stalled readiness, page digest correlation and recovery are verified.

Migration 36 implements the conservative UTC OTP transition without changing earlier migrations or financial/account history. All 160 Jest suites and 1,188 tests pass, along with TypeScript, Prisma validation, production/standalone build and the final compiled collection/outage/STARTTLS OTP/refund smokes. Affected code/script lint has zero errors; seven existing image warnings remain for AUD-045. The first full run's five stale form/error expectations were repaired with all original assertions retained, then the full run passed. A parallel smoke startup returned one 503; the diagnostic standalone outage rerun passed without application changes. The runbook documents readiness caching and separate hosted/browser certification.

See [reliability evidence](RELIABILITY_IMPLEMENTATION_NOTES.md) and [rollout/reproduction steps](RELIABILITY_RUNBOOK.md). No production migration/deployment, hosted provider operation or main merge occurred. At that checkpoint the next task was AUD-044; its later completion is recorded below.
## Completed AUD-044 checkpoint

The disposable migration/seed/full-Jest gate, four browser projects and GitHub
workflow are implemented. Local verification passed 161 suites / 1,190 tests,
28 browser cases, 11 native cases, TypeScript, Prisma and the production build.
Browser tests found and fixed the first-input login hydration race and cached-
profile/server snapshot mismatch. Final compiled collection/outage/OTP/refund
checks passed. Both PostgreSQL 16 and 18 verification jobs in
[run 41834749145](https://github.com/asiburrahman/amar-gadget/actions/runs/41834749145)
passed, including the complete test suite and actual browser cases. AUD-044 is
implemented and verified; the count is 47 of 51. Full-repository lint debt remains
AUD-045 (25 errors / 37 warnings); its separate CI gate correctly fails and is
not bypassed. This is not a claim that the entire release is green.
See [release verification](RELEASE_VERIFICATION.md).

## Completed AUD-045 checkpoint

Full-repository lint is clean (zero errors/warnings), with warnings now fatal.
Actual UI lifecycle, pagination and browser-lock defects are fixed rather than
suppressed. Local verification passed 167 suites / 1,209 tests, 15 native tests,
32 browser cases, TypeScript and the production build. All three remote CI jobs
passed in [run 42000256039](https://github.com/asiburrahman/amar-gadget/actions/runs/42000256039),
with the actual test counts inspected in both PostgreSQL logs. AUD-045 is
complete and the count is 48/51. See [AUD-045 evidence](LINT_UI_VERIFICATION.md).

## AUD-046 local verification checkpoint

Public pages/articles now use administrator-reviewed retained publications,
with private drafts, exact decision receipts and revision history. Legacy entry
routes and missing/error screens are useful, and README/setup/public claims
match the implemented contracts. The new additive migration preserves existing
account/catalog/order/event records and seeds no operator publications.

Local verification passed 172 suites / 1,250 tests with no skips, 16 native tests,
40 browser cases, TypeScript, Prisma, strict lint, production/standalone build,
compiled content and actual outage/recovery checks. Failed initial assertions
and the repaired WebKit owner-header capture are documented rather than hidden.
Remote CI remains pending the separate AUD-046 push, so the count stays 48/51.
See [content evidence](SITE_CONTENT_IMPLEMENTATION_NOTES.md). AUD-049 remains
the next separate implementation task; AUD-051 remains external.

## Owner-provided introduction

Asibur completed graduation approximately four years before this conversation, is not a student, currently does programming using Codex and other platforms, and has completed several web-development projects. Do not invent an employer, degree subject, audience size, customer metrics or professional title beyond this supplied information.
