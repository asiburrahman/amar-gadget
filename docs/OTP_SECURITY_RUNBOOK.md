# OTP deployment and verification

AUD-009 separates signup, password reset and email-change credentials. Each token belongs to one database account, purpose and normalized target email. The database stores an HMAC-SHA256 digest, random token identity, account-state fingerprint, expiry, delivery marker and attempt count. The six-digit code exists only in process memory and the outgoing message. Do not print codes, password hashes or mail credentials in diagnostics.

## Configuration and coordinated rollout

1. Generate a dedicated private `OTP_SECRET` with at least 32 random bytes and store it in the deployment secret manager. For example, run `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"` privately and save the output directly to the secret manager. Never paste it into chat, commit it or capture it in application screenshots. There is no fallback key. Changing it invalidates outstanding OTP digests.
2. Configure explicit `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`. Port 465 uses implicit TLS; other ports require STARTTLS. AUD-051 additionally requires the account owner to revoke the historically exposed credential; a source change does not perform revocation.
3. Rehearse against a disposable database with the current schema and representative existing data. Stop/drain old application instances and OTP requests for the rollout. Apply migration `20261028200000_bound_hashed_otp` and deploy this application revision together. Old application code cannot use the new token schema. Do not allow mixed old/new OTP writers.
4. The migration intentionally invalidates **all pre-migration pending OTPs**: their purpose and requester cannot be inferred safely. Ask affected users to request a fresh code. It does not delete accounts, passwords, orders or order history. A rollback to old application code requires a reviewed schema restoration, not just an application restart. Do not restore old plaintext codes.
5. Verify signup, password reset and authenticated email change using an authorized test mailbox. Check actual receipt, wrong-code handling, resend cooldown and final account state. Automated tests intercept SMTP only in tests; no real provider delivery is claimed by them.

No production migration, secret installation or provider operation was performed by this implementation.

## Account and credential behavior

- Signup verification requires both its signup code and the password used to register. This prevents a pending-registration password replacement from being activated by an email owner's code alone. Already verified users sign in; users without the registration password use password reset.
- Password reset accepts only a `PASSWORD_RESET` code and returns no login cookie. The user signs in with the new password afterward. Existing-session revocation remains the separate AUD-010 work item.
- Email change requires a current signed-in account and current-password reauthentication before requesting a code for the new address. Resending returns to password entry. Only that same account can consume its `EMAIL_CHANGE` code. Account email and single-use consumption commit in one transaction. An email uniqueness conflict rolls back both.
- Changes to email, password, verification state, role or seller status invalidate outstanding codes through the account fingerprint. The fingerprint also incorporates a session version when present. Successful OTP mutations remove all other pending tokens for that account; other accounts are unaffected.
- Registration and email-change JWTs are signed before committing the account mutation. A signing/configuration failure preserves the pending code and account state. The transaction rechecks account state before returning a usable response.

## Limits and failure handling

Each account/purpose has a persistent database budget: at most three sends per fixed ten-minute window, at least 60 seconds between sends, and five verification attempts per fixed ten-minute window across resends. A token independently permits five attempts and expires after ten minutes. Budgets use the database clock and serialized user-row locking. Denied requests do not extend the fixed window. `429` responses include `Retry-After`. Existing IP limits apply in addition; trusted proxy enforcement remains AUD-041.

A token cannot be consumed before its delivery callback succeeds and its own identity is marked delivered. Failed SMTP delivery removes only that issuance. A late older delivery cannot mark or delete a replacement token. Provider ambiguity can mean an email arrives whose code was invalidated; the user must request a fresh code after the cooldown. Never describe a delivery attempt as confirmed inbox receipt.

Wrong-code attempts commit their budget even though no account mutation occurs. Correct verification produces a private in-memory capability; it is never serialized or accepted from the client. Expiry, supersession, scope and account state are checked again under the account lock when consumption and the account mutation commit. Expensive password hashing runs outside that lock. Concurrent replay has at most one successful consumer. Database/action failures roll back token consumption.

## Verification evidence and remaining scope

SQL integration tests cover purpose/identity isolation, HMAC storage, replay, concurrency, fixed-window budgets, pending/failed/superseded delivery, expiry, credential-state changes, email uniqueness rollback and signing failure. DOM tests exercise signup password proof, leading-zero codes, pending-request guards, server cooldown, email-change reauthentication, failed delivery/verification and server-confirmed account updates. Fixtures and provider mocks occur only in tests.

Fresh seven-migration installation and a separate six-to-seven upgrade were exercised on isolated PostgreSQL databases. The upgrade compared complete account, order and order-history records before/after and confirmed old tokens were removed and new constraints present.

Password strength unification, account-enumeration policy, session revocation, runtime environment consolidation, trusted ingress, actual SMTP/browser verification and CI remain tracked independently; this task does not certify the whole authentication system or application production-ready.
