# Findings discovered during implementation

The original 49-task audit is preserved as a baseline. These findings add work; they do not replace or silently narrow any original task. Open items remain part of the standing complete-implementation objective.

## AUD-050 — Dependency security remediation (open, urgent)

Discovered during AUD-008 verification on 28 October 2026 (Asia/Dhaka). `npm audit` reports 27 vulnerable package entries (6 low, 6 moderate, 13 high, 2 critical). The production-dependency view (`npm audit --omit=dev`) reports 17 entries: 6 moderate, 10 high, 1 critical. Counts are affected-package entries, not unique vulnerabilities or proof that every advisory is exploitable in this deployment.

The pinned `next@16.2.10` is within published affected ranges, including [Windows-hosted server RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36) and [Image Optimization SVG RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw). The npm audit dependency graph also flags Prisma/config, Zod and transitive packages. Review the actual advisory conditions and complete graph before choosing upgrades; do not assume only bumping Next fixes everything. No exploit or production exposure test was run.

Acceptance criteria:

1. Verify available patched versions and Node/React/Prisma compatibility against primary release/advisory information. Read the updated installed Next guides before changing application code.
2. Update the manifest/lockfile and affected source/config deliberately; preserve existing application behavior and every audit task's scope. Do not use blanket `audit fix --force`, fake resolutions or unexplained suppression.
3. Re-run full and production-only dependency scans. Resolve high/critical findings and available fixes for lower-severity findings; record any unresolved advisory with concrete reachability/fix evidence rather than claiming a clean scan.
4. Verify real PostgreSQL integration, unit/DOM tests, TypeScript, affected-file lint, schema validation and production build. Rehearse migrations if the upgrade affects the adapter/schema toolchain.
5. Record actual results, remaining provider/browser/production checks and a focused professional commit/push.

This task is next after AUD-008 because of the confirmed affected framework version. AUD-044 remains responsible for durable CI/browser/release gates; it is not closed by dependency remediation alone.
