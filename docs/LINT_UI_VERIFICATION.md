# AUD-045: repository lint and UI lifecycle verification

This task fixes the defects exposed by repository lint, rather than suppressing
the rules. The original audit's invalid `useHydratedStore` hook was replaced
during the persisted-cart work. The current cart controller subscribes through
Zustand, starts after mounting and locks the account scope while session
authority is unknown. The release browser suite exercises persisted cart and
authenticated reload behavior; it does not assume cached profile data is an
authenticated session.

## Changes

- Buttons accept typed native button attributes, including `aria-current` and
  form attributes. Hover classes are complete static Tailwind tokens.
- Pagination includes the middle page of small ranges, keeps distant boundaries
  and current neighbors reachable, and clamps stale page inputs.
- Dialog opening derives from its current prop. Closing remains mounted for the
  animation but becomes inert. Keyboard focus, Escape, return focus, scroll
  restoration, quick reopening and timer cleanup have explicit regressions.
- Toast consumers and their provider share one controller. Replacement and
  dismissal clear their own timers, invoke dismissal callbacks once and retain
  a newer notification created by a callback. Unmount clears owned resources.
- Tabs export their composition components and actually select linked panels.
  Arrow/Home/End navigation skips disabled tabs; hidden panels retain form
  drafts without remaining interactive.
- Dropdown uses a native trigger button and a nonmodal dialog, focuses its
  content, closes on Escape/outside pointer/focus, and returns focus on Escape.
  Viewport measurements implement alignment, side/padding offsets, vertical
  flipping and horizontal collision padding. The body portal avoids clipping by
  an ancestor. Disabled transitions close the popup without reopening it later.
- Navbar forwards its supplied class name. Previously native image elements
  use explicit-size/fill Next Image components with direct delivery
  (`unoptimized`), preserving the existing configured media/CDN path rather than
  introducing a new optimizer-fetch dependency. This does not claim image
  compression or a performance measurement.
- Login validates the successful account response. The OTP route uses the
  router; authenticated principal changes deliberately replace the whole
  document through a closed same-origin role map, discarding private router
  and component state. Stale redirect timers were removed.
- Analytics accepts unknown event data and checks the actual available browser
  globals. Password-reset errors are narrowed from `unknown`.
- Browser locks return a fulfilled result envelope from the native callback and
  rethrow the original failure only after the native request settles. Cart and
  wishlist retain the same locks, errors and repository retry policy. A caught
  stale-revision error must not also surface as an uncaught browser rejection.

The generic Tabs, Dropdown and Toast primitives had no application consumers in
the inspected source. Their component tests prove their reusable behavior; this
task does not advertise a newly connected application feature on that basis.

## Removed unused artifacts

The five empty `types/{api,auth,order,product,user}.ts` files and the unused
`lib/validations/user.ts` import-only file had no importers. Their removal does
not remove runtime validation or replace real types with placeholders.

The unreferenced root `seed.js`, `scripts/seed-products.js`,
`scripts/clean-demo-products.js` and `scripts/test-seller-update.js` were
obsolete manual scripts. They loaded ambient environment configuration, used
outdated adapter/catalog contracts and could create fake catalog data, approve
an arbitrary first seller or delete purchase/review data. They were inspected,
never executed. No package command called them. The supported canonical seed
remains `prisma/seeds/seed.js`, configured by `prisma.config.ts`, and creates
reference categories/brands without login accounts or products.

## Verification checkpoint

The later documentation-only AUD-044 run
[41836918368](https://github.com/asiburrahman/amar-gadget/actions/runs/41836918368)
failed the Firefox cancellation browser case in both PostgreSQL jobs, after the
prior recorded run had passed. Its retained PostgreSQL 18 trace identifies a
caught `Guest cart changed in another tab` rejection from a Web Locks callback.
A separate minimal local HTTP/browser experiment reproduced Firefox's pageerror
for an explicitly caught native callback rejection; Chromium and WebKit did not
emit it. This is observed behavior in the installed engines, not an assertion
about every Firefox release. The application-side envelope fixes that boundary;
the uncaught-error gate remains enabled and now includes redacted messages.
Four unit cases preserve success, exact failure, acquisition failure and
no-Web-Locks semantics. A new real UI/browser case forces a queued stale cart
write, verifies the unchanged persisted quantity and visible conflict, then
refreshes/retries and verifies the saved quantity after reload.

The first corrected 32-case browser run passed 31 cases and failed WebKit's
public-navigation check: its recovery probe incorrectly retried a captured
read-only `POST /api/cart/guest` as GET and received 405. The fixture now retains
the original safe read's method/body and RSC headers. Only captured same-origin
GETs and the explicit read-only guest-catalog POST are eligible; arbitrary
mutations, foreign origins and missing/invalid/oversized bodies fail. Four
native policy tests enforce these limits. Recovery must still receive 200 and
all JavaScript errors remain in the failure gate, including errors during the
recovery probes themselves. All 15 native tests pass. This fixture correction
does not change application endpoint methods or discard failed browser results.

Local targeted checks passed all five new suites / 15 tests. Full-repository
ESLint reports **zero errors and zero warnings** without added rule disables or
source ignore patterns. TypeScript passed. The first full isolated run passed
**166 suites / 1,205 tests**, zero skips; its production build and all original
28 browser cases passed locally. Those runs preceded the native-lock boundary
correction. The lock/cart/guest/legacy/wishlist targeted run passed **68 tests
across five suites**. Final build/browser and remote CI verification of the
correction are pending; completion requires their actual terminal results.

The final isolated run passed **167 suites / 1,209 tests**, zero skipped suites
or tests, with the native-lock correction included. Its overnight wall-clock
duration is not used as a performance measurement. The browser run across that
interval failed its metadata eligibility checks and later reached the global
timeout (17 passed, two failed, 13 not run); it is not passing evidence. Trace
inspection confirmed some WebKit diagnostics had no protocol request event.
A pre-dispatch observer now retains only safe read metadata in a bounded,
test-only session-storage key across document replacements. Snapshots still
must pass the same replay policy. No native fetch promise is changed and no
credential/mutation body is recorded. Focused and complete browser results must
be checked after this correction. The lint command now also fails on warnings
(`eslint --max-warnings=0`) so future warning debt cannot silently pass CI.

## Final local verification (5 November 2026, Asia/Dhaka)

- Full isolated Jest: **167 suites / 1,209 tests passed**, no skips; migration
  deploy and the twice-idempotent reference seed passed in the owned database.
- Final production/standalone build and TypeScript passed with the native-lock
  correction included. No application source changed after that build.
- Strict full-repository `npm run lint` passed with zero errors/warnings.
- **15 native tests passed**, including the four replay-policy cases; the
  malformed-port hardening also passed its focused policy run.
- The two previously failing WebKit navigation/COD cases passed together.
  The subsequent complete run passed **32 browser cases** across all four
  projects, no retries. Its observed duration was 4.3 minutes.
- `git diff --check` passed. The database schema and all 36 existing migrations
  are unchanged in this task.

At this local checkpoint remote CI was pending the first push, so the task and
47/51 count remained open. The remote result is recorded below. Local checks do
not certify hosted providers or deployment.

## Remote verification and closure (5 November 2026)

Implementation: [5912e80](https://github.com/asiburrahman/amar-gadget/commit/5912e80d2c91520618e323ad37e03f068d30a567).
[Run 42000256039](https://github.com/asiburrahman/amar-gadget/actions/runs/42000256039)
completed successfully; all three jobs passed:

| Job | Inspected evidence | Result |
| --- | --- | --- |
| [Repository lint](https://github.com/asiburrahman/amar-gadget/actions/runs/42000256039/job/127153368075) | `eslint --max-warnings=0` | Success |
| [PostgreSQL 16](https://github.com/asiburrahman/amar-gadget/actions/runs/42000256039/job/127153368541) | 167 suites / 1,209 tests, no skips; 15 native tests; 32 browser cases | Success |
| [PostgreSQL 18](https://github.com/asiburrahman/amar-gadget/actions/runs/42000256039/job/127153368558) | 167 suites / 1,209 tests, no skips; 15 native tests; 32 browser cases | Success |

Both database jobs also passed Prisma validation, TypeScript, the production/
standalone build and compiled collection/outage/OTP/refund checks. The actual
job logs were inspected, including the no-skipped-tests marker and browser
summaries; overall job status alone was not substituted for test evidence.

AUD-045 is complete within its recorded scope. The current count is **48/51**;
AUD-046, AUD-049 and external AUD-051 remain. Earlier failed runs remain above.
No production migration/deployment, hosted provider operation or main merge
occurred. The complete remaining-task objective stays active.

Reproduce with an explicitly guarded disposable local `TEST_DATABASE_URL`:

```sh
npm run lint
npx tsc --noEmit
npm run test:isolated
npm run build
npm run test:browser
git diff --check
```

The isolated runner creates, migrates and seeds its own random database and
drops only that database. The browser runner uses its own database and local
provider transport fixtures. No production database, hosted provider, external
recipient/payment or main-branch merge is part of these checks. Remote CI also
verifies PostgreSQL 16 and 18 separately; local results must not be substituted
for that remote evidence.
