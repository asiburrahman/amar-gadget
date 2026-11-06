# Session revocation and rollout

AUD-010 adds a nonnegative database `User.sessionVersion`. New HS256 JWTs carry the exact account version and expire after seven days. Every protected API/action/layout checks the signature, expiry, required claim shape, current verified account, email, role and version through `lib/session-validation.ts`. That lookup uses current database state without a cross-request cache. A missing account or stale version is unauthenticated. Database failure does not authorize access.

## Session policy

- Password reset or password change revokes **all existing sessions**, including the current browser. Password change expires its cookie, clears client authentication and navigates to login. Password reset does not sign in automatically. A new login with the current password receives the current version.
- A PostgreSQL `BEFORE UPDATE` trigger increments the version once whenever password hash, email, role, verification flag or seller status changes. It covers application routes, administrator provisioning and operator SQL. A hash-format upgrade also revokes existing sessions: successful legacy login reloads the resulting version before issuing its cookie. Concurrent reset cannot be overwritten by that upgrade.
- Email verification and email change sign the planned next version before committing their locked OTP mutation. This preserves the account/code on signing failure. Email change returns a fresh current-browser cookie; all older cookies become stale. Failed verification, password mismatch, uniqueness conflict or transaction rollback does not revoke a valid session.
- Name, phone, avatar and address edits do not revoke sessions. An operator may explicitly increment the version to revoke all cookies. Decreasing the version is rejected. Do not modify the trigger to restore an older version.
- Logout remains a browser-cookie removal operation; copied cookies are revoked by security-state changes or expiry. Per-device session inventory/revocation is not advertised by this implementation.

Requests already authorized before a security-state change may finish an ordinary profile operation. Password changes additionally compare both the original password hash and session version during the update. OTP mutations recheck the full account fingerprint under the account lock. This task does not claim to cancel in-flight network requests or roll back an operation that already committed.

## Boundaries

`lib/session-token.ts` provides cryptographic signing/shape verification only. Its verifier is used by the optimistic navigation proxy and the database validator; it is insufficient to authorize protected data by itself. The proxy has no fallback signing secret and makes no database calls. All matched dashboard role layouts still enforce database validation; APIs and server actions enforce their own checks independently. Stale-cookie navigation can pass the optimistic proxy and is then rejected by the layout. Supplied `x-user-*` headers are never treated as authority.

Profile, avatar, password-change and `/api/auth/me` routes formerly performed signature-only checks. They now use the same database validator as `getCurrentUser`. No alternate signature-only application data path remains. The old ad hoc first-user token-printing and fixed-credential HTTP login scripts are removed; isolated regression suites replace them.

## Coordinated deployment

1. Rehearse migration `20261028210000_session_revocation` on a disposable database, then review the production rollout/backup separately. This implementation has not migrated production.
2. Drain old application instances and apply the migration before deploying this revision. The new application requires the column. Old application instances do not enforce revocation and must not remain serving protected traffic.
3. Existing accounts receive version zero without changing their passwords, orders or history. **All JWTs issued before this revision lack the required version and must sign in again.** Do not add an implicit zero fallback to accept them. Inform users of the deployment sign-out.
4. Keep a private `JWT_SECRET` of at least 32 bytes; no fallback is allowed. Existing OTP configuration still requires its separate private key. Confirm that all protected entry points use the validator and that the database trigger is installed. Runtime environment consolidation remains AUD-040.
5. Use test accounts to confirm a copied old cookie fails after reset/change, a new login succeeds, email change replaces the current cookie, and ordinary profile edits keep the session. Avoid capturing cookies or credentials in logs, screenshots, issue bodies or videos.

Reverting to old application code restores signature-only behavior and bypasses revocation. A rollback must preserve the security boundary; do not blindly roll back this release after a security event.

## Verification

The PostgreSQL integration suite uses the actual jose signing/verification implementation (Jest compiles its ESM package), actual database triggers, application routes and scrypt. Only framework cookie access and external IP-limiter boundaries are controlled test fixtures. Cases cover copied-cookie revocation, fresh login, reset, current-browser clearing, every formerly signature-only API, malformed/expired/forged/legacy tokens, account deletion/security-state changes, signup and email-change replacement cookies, reset/login races, concurrent password changes and transactional rollback.

Fresh eight-migration installation plus seed and a separate seven-to-eight upgrade were exercised. The latter preserved complete pre-existing account/order/history records and added only version zero to the account. Password/account input policies, distributed rate limits, provider/browser release testing and full CI remain separately tracked tasks; this change does not close them.

The standalone HTTP smoke also uses an isolated short-lived fixture JWT to read the real profile endpoint, revokes its database version, checks the copied cookie loses API access and verifies the dashboard's login redirect. Next can emit a 200 response containing its documented redirect meta tag after streaming starts; the smoke requires that exact login destination or a normal HTTP redirect. This is server-render/HTTP evidence, not a browser-navigation claim. Initial probe/assertion failures and their limits are retained in the implementation log.
