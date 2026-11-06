# Account input and request policy

AUD-011 unifies new-password validation and bounds the account mutation entry points. Schemas are shared between server handlers and password forms. Existing database credentials are not mass-changed.

## Passwords and fields

Registration, password reset/change and configured operator account creation use the same policy: 8–128 characters, with uppercase, lowercase, a number and one of the existing registration special characters. This preserves the application's established registration policy and applies it consistently. Passwords are never trimmed, normalized or truncated. Login/signup verification/current-password proof accept existing password values up to the password service's bounded input; a legacy password is not rejected merely for lacking the new-password rules. Successful legacy rehash preserves the chosen password.

Names, email, phone, image representations and address fields have explicit length/type limits. Names/address fields trim surrounding whitespace and reject PostgreSQL-incompatible null characters. Email is normalized to lowercase. Profile updates accept only the permitted fields and reject unknown privilege fields. When an address is supplied, its required delivery fields must all be valid **before any user write**. The default-address operation still needs transactional consistency under AUD-039; validation alone does not close that task.

HTTPS image URLs have a 2,048-character bound and reject embedded credentials. Existing PNG/JPEG/WebP base64 representations remain bounded at seven MiB of encoded text, and registration's picker rejects files over five MiB or other declared types. This compatibility path does not verify actual file signatures or ownership and does not replace AUD-038's storage-backed avatar migration. Product/gallery and object lifecycle validation remain AUD-016/017/047.

## Request parsing

`readAccountJson` limits actual streamed bytes before JSON parsing, independently of a supplied Content-Length. Ordinary account requests allow 16 KiB. Registration/profile mutation retain a seven-MiB encoded-avatar allowance plus 16 KiB of other fields until the avatar migration. Oversize bodies return 413; absent, malformed or invalid UTF-8 JSON returns 400. Typed/schema failures return controlled 400 responses. Unknown internal errors return generic service errors without exception, provider, SQL, password or token details. No request body or raw identity is logged by these helpers.

## IP and identity budgets

| Mutation | IP budget | Identity budget |
| --- | --- | --- |
| Login | 10/minute | 10/minute per normalized email |
| Registration | 5/minute | 3/10 minutes per normalized email |
| Forgot password / signup resend | 5/minute each | 3/10 minutes each per normalized email |
| Signup verification / password reset | 5/minute each | 5/10 minutes each per normalized email |
| Email-change request / verification | 5/minute each | 5/10 minutes each per authenticated account |
| Password change | 5/minute | 5/10 minutes per authenticated account |
| Profile PUT | 60/minute | 30/minute per authenticated account |

IP checks happen before parsing/password work. Public identity checks happen after bounded schema validation and before account lookup. Authenticated identity comes from the validated session, never a body user ID or requested target email. Limiter keys digest the identity and use separate operation/account/IP namespaces; changing an IP cannot change the target account's budget. The digest is pseudonymization, not irreversible anonymization. A 429 includes a conservative Retry-After equal to that limiter window; SQL OTP limits can return a more precise remaining interval. Read-only me/profile requests keep their existing session checks; avatar/media throttling remains part of AUD-038.

Budgets use the existing configured Upstash service and fail closed in production if it is missing/unavailable. Runtime fail-fast service configuration and trusted ingress headers remain AUD-040/041. Tests control the provider boundary and prove key selection, source-IP changes and pre-write denial; actual configured Upstash service behavior is still release verification. No production Redis request or setting was changed here.

## Public request responses

Forgot-password and signup-resend routes acknowledge receipt with the same body/status for absent, eligible and temporarily undeliverable accounts after the same public identity/IP budgets. The wording asks users to check for a new or recently requested code and retry later if none arrives; it does not assert successful delivery. Actual eligible requests still execute real configured OTP issuance/delivery, and failures produce a static, identity-free operational warning. Registration and password-proven login continue to report their actionable account states.

These response bodies/statuses do not promise timing indistinguishability: provider delivery is still synchronous and may vary. Durable notification/outbox and deployment observability work must account for that boundary under AUD-033/042/044. No blanket account-enumeration prevention claim is made.

## Verification and rollout

No migration is needed for this task. Existing session/OTP migrations and dedicated private keys remain required. Deploy with the configured rate limiter and exercise the real forms using authorized test accounts. Unit/SQL/DOM cases cover shared strength/length rules, old-password preservation, malformed and streamed oversized bodies, privilege/URL/type rejection, normalization, account/IP denial before writes, source-IP variation, generic reset outcomes and internal-error redaction. Password reset clears entered secrets and prevents another submission after success. Actual provider delivery and browser/device testing remain separately tracked release checks.
