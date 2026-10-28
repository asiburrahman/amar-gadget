# Findings discovered during implementation

The original 49-task audit is preserved as a baseline. These findings add work; they do not replace or silently narrow any original task. Open items remain part of the standing complete-implementation objective.

## AUD-050 — Dependency security remediation (implemented; explicit development vendor mitigation)

Discovered during AUD-008 verification on 28 October 2026 (Asia/Dhaka). `npm audit` reports 27 vulnerable package entries (6 low, 6 moderate, 13 high, 2 critical). The production-dependency view (`npm audit --omit=dev`) reports 17 entries: 6 moderate, 10 high, 1 critical. Counts are affected-package entries, not unique vulnerabilities or proof that every advisory is exploitable in this deployment.

The previously pinned `next@16.2.10` is within published affected ranges, including the maintainer's [Windows-hosted server RCE](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) and [Image Optimization SVG RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) advisories. The initial npm audit graph also flagged Prisma/config, Zod and transitive packages. No exploit or production exposure test was run.

Acceptance criteria:

1. Verify available patched versions and Node/React/Prisma compatibility against primary release/advisory information. Read the updated installed Next guides before changing application code.
2. Update the manifest/lockfile and affected source/config deliberately; preserve existing application behavior and every audit task's scope. Do not use blanket `audit fix --force`, fake resolutions or unexplained suppression.
3. Re-run full and production-only dependency scans. Resolve high/critical findings and available fixes for lower-severity findings; record any unresolved advisory with concrete reachability/fix evidence rather than claiming a clean scan.
4. Verify real PostgreSQL integration, unit/DOM tests, TypeScript, affected-file lint, schema validation and production build. Rehearse migrations if the upgrade affects the adapter/schema toolchain.
5. Record actual results, remaining provider/browser/production checks and a focused professional commit/push.

### Verification result

All five acceptance steps were completed: manifest and lockfile upgrades are deliberate; the supported Prisma 7 family remains aligned at 7.10.1 rather than moving to an 8 release candidate. Next/eslint-config-next use 16.4.3, React/React DOM 19.2.9, Zod 4.6.7, Nodemailer 10.2.1 and current compatible Jest/ts-jest releases. Targeted transitive updates resolve the remaining high/moderate graph entries. Clean `npm ci` reproduced the install and applied the committed development patch.

`npm audit --omit=dev` now reports **0 vulnerabilities**. The full scan reports **6 low-severity package entries**, all from the unpatched upstream deepmerge advisory and its Jest/ts-jest ancestors. Registry release/advisory information was reviewed: no upstream patched version is available. The [committed local source mitigation](../patches/README.md) uses own data-property writes at every destination-write site and is reapplied with failure checking during install/build. Five regression cases demonstrate the original poisoning path and verify installed CommonJS/UMD behavior, including all three write branches. Original versions/advisory output are retained; the full scan is explicitly **not** claimed clean or suppressed. Neither Jest nor deepmerge is present in the inspected standalone production node_modules, and npm confirms no production dependency path to deepmerge.

Evidence: [dependency snapshot](dependency-security-2026-10-28.json), 116 tests in 16 suites, TypeScript, affected-file lint, schema validation, fresh six-migration install/seed, existing-data retention, production build and actual standalone HTTP/SQL/SSR/unauthenticated-admin smoke. An initial generic smoke probe failed once without a classified cause; diagnostic improvements followed by five successful runs (including immediately after a fresh build) did not reproduce an application failure. Cold-start/browser/provider observability remains release verification. The smoke runner cleans its own fixture rows and child server. Docker CLI is absent, so container build is not marked verified. No production migration, deployment or provider request was made.

AUD-044 remains responsible for durable CI/browser/release gates and upstream patch monitoring; it is not closed by dependency remediation alone. The next original task remains AUD-009.

## AUD-051 — Remove exposed SMTP credential and confirm revocation (code remediated; operator action pending)

During AUD-009 source tracing, `lib/mail/nodemailer.ts` was found to contain tracked hardcoded SMTP authentication fallback values. The credential value is deliberately not copied into this report. The repository is public; removing a fallback from current source cannot invalidate a credential already present in historical commits. No attempt was made to authenticate with it or send a message.

Code remediation removes hardcoded account/password/host fallback behavior, requires explicit private SMTP settings, selects implicit TLS for 465 and required STARTTLS otherwise, and bounds transport timeouts. OTP mail requires an explicit sender before writing an undeliverable token and no longer exposes raw provider errors or logs credential/code details. Regression tests use controlled transport responses only; no provider connection occurs.

**Remaining owner action:** revoke the exposed app password/credential in the provider account and privately configure a new credential in the actual environment/secret manager. Do not paste either credential into chat, issues, commits or screenshots. For Google app passwords, see [Google's removal instructions](https://support.google.com/accounts/answer/185833#zippy=%2Cremove-app-passwords). The account owner must confirm revocation; source removal is not proof of that external state. History is not rewritten by this work.

This additional task stays open until that confirmation is received. Actual configured SMTP delivery remains release verification under AUD-044. Independent original audit work continues; no production deployment/account change is performed automatically.
