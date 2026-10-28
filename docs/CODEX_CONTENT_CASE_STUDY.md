# A green build hid a broken marketplace checkout

By Asibur Rahman, with implementation assistance from OpenAI Codex.

## What I investigated

Amar Gadget is my Next.js multi-vendor marketplace. I asked Codex to audit how the storefront and dashboards connect to backend behavior, then implement and verify fixes on a public branch. The audit found 49 tasks, including a runtime database blocker that the existing 17 passing unit tests could not detect.

The application used Prisma's Neon HTTP adapter, while order creation, OTP verification and payment confirmation used interactive transactions. The installed adapter rejected transaction startup with `Transactions are not supported in HTTP mode`. A successful TypeScript check and production build did not execute those database transactions.

## What changed

The first implementation batch replaces the HTTP adapter with the PostgreSQL TCP adapter for both application and seed code. I used a separate disposable local PostgreSQL database to apply the repository's migrations and exercise the application code. Tests cover checkout commit/rollback, stock contention, single-use OTP consumption, signed webhook processing and duplicate expiry handling.

The same batch escapes product structured data before rendering JSON-LD, applies seller approval consistently to public catalog queries, restricts customer-data access for unapproved sellers, and guards seller shipment updates against concurrent cancellation.

## What this demonstrates

Codex helped connect a dependency capability mismatch to several user-visible failures, implement a correction, and add tests at the boundary the old mocks skipped. The evidence is the code, the tests, and their recorded results. Locally signed payment events do not prove that the deployed Stripe integration works; external-service and browser verification are still separate work.

- [Original audit and task list](DEEP_AUDIT_2026-10-28.md)
- [Implementation details and reproduction steps](CODEX_IMPLEMENTATION_LOG.md)
- [Public branch](https://github.com/asiburrahman/amar-gadget/tree/codex/deep-audit-2026-10-28)
- [Diff from the original main baseline](https://github.com/asiburrahman/amar-gadget/compare/37a80a8...codex/deep-audit-2026-10-28)

## Short introduction video draft

“আমি আসিবুর রহমান। Amar Gadget নামে একটি multi-vendor marketplace তৈরি করছি। Codex দিয়ে audit করে দেখলাম, build আর unit test পাস করলেও database adapter-এর কারণে checkout ও OTP transaction কাজ করছিল না। Codex-এর সাহায্যে adapter ঠিক করেছি, বাস্তব local PostgreSQL-এ transaction tests যোগ করেছি, আর security ও seller access-এর সমস্যাও ঠিক করছি। পুরো code ও test evidence GitHub-এ আছে। এই ধরনের বাস্তব debugging workflow বাংলায় demo আর tutorial হিসেবে community-র সঙ্গে শেয়ার করতে চাই।”

This is a draft for the owner to personalize and record; no video or community post has been published by this work.
