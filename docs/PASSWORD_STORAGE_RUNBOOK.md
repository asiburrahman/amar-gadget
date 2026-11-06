# Password storage and account migration

New passwords use `scrypt$v1$65536$8$2$<16-byte salt as hex>$<64-byte key as hex>`. The parameters match an [OWASP-listed scrypt profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt). The implementation uses [Node's asynchronous scrypt API](https://nodejs.org/docs/latest-v20.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), available in the supported Node versions. No password is encrypted for recovery, normalized, trimmed or silently truncated.

Two KDF jobs per application process can run simultaneously; sixteen can wait, for at most five seconds. Saturation is an explicit HTTP 503 with `Retry-After: 5`. Each scrypt job uses approximately 64 MiB for its core work, with a 96 MiB native memory ceiling; reserve application/runtime memory in addition. Account/IP rate limits remain important across processes. Unknown/malformed accounts and incorrect legacy credentials perform current KDF work before denial, reducing the account-existence timing difference. Strict format validation prevents a stored parameter string from requesting arbitrary CPU or memory.

Legacy records have exactly `<32 lowercase hex salt>:<128 lowercase hex PBKDF2-SHA512 digest>`. Verification preserves the original 1000-iteration **salt string** contract only for compatibility. Do not generate new hashes in that format. After successful verification, login writes a new scrypt hash only if the stored hash is still unchanged. If another request changed it, login verifies the current credential before issuing a session. The database stores passwords as nullable text, so this upgrade requires no schema migration and no bulk reset. Malformed/unsupported hashes require an actual password reset; never bypass verification to recover such accounts.

New registration/reset/change and local/private provisioning all await the shared hash function. Password change also compares the previously verified stored hash to avoid overwriting a concurrent reset. Existing unverified registration updates use a conditional write to avoid overwriting an account verified or changed while hashing. Password-strength policy unification and session revocation are separate AUD-011 and AUD-010 work; do not infer they are implemented from this storage migration.

Operator commands run from an authorized checkout with development dependencies installed:

```sh
npm run bench:passwords
npm run audit:password-formats
npm run seed:accounts
npm run provision:admin
```

The benchmark has no database access and logs only resource/timing measurements using a temporary random input. Format inventory reads in bounded pages, prints aggregate current/legacy/missing/unsupported counts and does not guess passwords or log accounts/hashes. Concurrent account changes may affect an inventory scan; it is an operational inventory, not a transactional snapshot.

Local account seeding requires all `SEED_ADMIN_EMAIL/PASSWORD`, `SEED_SELLER_EMAIL/PASSWORD` and `SEED_USER_EMAIL/PASSWORD` values and is disabled in production. It creates only missing accounts and leaves sellers pending approval. Provisioning requires an explicitly chosen **existing** account through `SEED_ADMIN_EMAIL` and a privately supplied `SEED_ADMIN_PASSWORD` meeting the registration password policy. It changes that account to verified ADMIN and replaces its password through a guarded write. Run it only when that exact account change is intended, with the correct database configuration. It is not automatically invoked on startup or migration. Never commit those values or log them in screenshots/terminal captures.

The former `seed-users-credentials.js` and `set-asibur-admin.ts` embedded credentials/targets and are retired. The old `check-passwords.ts` password-guessing/hash-output behavior is removed. Other legacy ad hoc registration/token diagnostics are follow-up work under AUD-009/010 and must not be used against real accounts; the isolated integration suites are the current verification path.

Run the benchmark on deployment hardware before release. Local measurements are recorded in the implementation log; they do not establish production throughput or a memory budget for every platform. Do not reduce the security cost through ad hoc environment overrides. A future cost change needs a new supported format, compatibility verification, resource measurement and migration tests. Storage upgrade alone is not completion of OTP, session, dependency or release-security work.
