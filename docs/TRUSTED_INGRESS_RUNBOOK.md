# Trusted ingress and exact browser origins

AUD-041 replaces caller-selected IP headers with a private gateway assertion. Deploy the gateway with this application revision. An unsigned production request to an application page, API or action receives 403; copying `CF-Connecting-IP`, `X-Forwarded-For`, Vercel headers or middleware headers does not establish trust. Plain GET/HEAD health probes, packaged public assets and Next static/image resources remain intentionally public. POST/action requests to those paths still require trusted ingress and origin checks. Session, role, ownership and provider-signature checks remain mandatory after ingress verification.

## Configuration and process layout

Generate a distinct private `TRUSTED_PROXY_SECRET` of at least 32 random bytes. Supply it to the app, gateway and authorized reservation worker. It must differ from JWT, OTP and sweep keys. Keep all values outside Git and outside browser bundles. Rotate the app/gateway/worker key together. No raw shared key is transmitted in a request.

Set `APP_URL` to the exact public HTTPS origin. Use `http://localhost:8080` or another explicit loopback origin only for local testing. The gateway checks the public Host and supplies that canonical host/protocol to Next; redirects use the same application origin. Additional production action origins and wildcard tunnel domains are not enabled. Browser writes must include exactly this Origin, including scheme and port. Missing, `null`, alternate-port and unrelated origins are denied. The Stripe webhook and checkout expiry POST endpoints alone allow a missing browser Origin, while still requiring trusted ingress plus their own Stripe/Bearer verification. They do not exempt server actions.

The supported process chain is:

1. Start the prepared production app bound to loopback, port 3000. For a native PowerShell deployment, set `$env:HOSTNAME = "127.0.0.1"` before `npm start`. Use the normal runtime configuration and readiness checks. For Docker, publish only `127.0.0.1:3000:3000`; do not publish the app to all host interfaces.
2. Start the gateway on the same host. Set `GATEWAY_ORIGIN_URL=http://127.0.0.1:3000`, `GATEWAY_PORT=8080` and choose the explicit IP mode below. With injected environment, run `npm run start:gateway`; with a private source-workspace env file, run `node --env-file=.env scripts/ingress-gateway.mjs`. The prepared artifact also contains this script and both native ingress modules. The gateway binds **only** `127.0.0.1`; do not place it behind an unauthenticated TCP forwarder that makes remote clients appear local.
3. For public deployment, configure a **named Cloudflare Tunnel on that same host** to route the hostname in `APP_URL` to `http://127.0.0.1:8080`, preserving the public Host. Use the operator's private named-tunnel credentials/configuration, then `npm run tunnel:local` or `cloudflared tunnel run`. The npm scripts no longer open an arbitrary quick tunnel to port 3000. Keep gateway/app ports private; only the tunnel publishes the hostname. Supervisor/service configuration must restart all required processes and route traffic only when readiness passes.

`GATEWAY_CLIENT_IP_MODE=cloudflare-tunnel` accepts only `CF-Connecting-IP` **from the local tunnel connection**. Missing, multiple or malformed values are rejected. Configure Cloudflare Pseudo IPv4 as **Off** or **Add Header**, preserving the real IPv4/IPv6 in that primary header. Overwrite Headers mode produces a Class E pseudo address and is deliberately rejected; auxiliary IPv6 and forwarded headers never override the primary identity. The local host and its processes are part of this trust boundary: any local process can connect to a loopback listener. Do not expose this listener through port forwarding, a generic public load balancer, another container network or an untrusted local user. Disable Cloudflare rules/features that remove the original visitor IP headers. Review Worker routes that can alter those headers; use a direct tunnel hostname without such Workers unless that path has been independently verified.

`GATEWAY_CLIENT_IP_MODE=socket` ignores all forwarded/Cloudflare IP headers and uses the canonical native socket peer. It is for direct loopback HTTP access, where all local callers intentionally share a limiter identity. It is not a visitor-IP mode for a public reverse proxy. There is no automatic platform detection or fallback to a caller-selected IP.

Development remains available directly through `npm run dev` on localhost. The production gateway is an HTTP gateway and returns 426 for WebSocket upgrades; use direct localhost for development HMR. Public remote testing should use the built production chain with the configured canonical hostname. Browser walkthrough and live tunnel deployment verification remain release checks, not results claimed by these local tests.

## Assertion and throttling contract

The gateway removes inbound forwarding, private assertion, middleware and hop-by-hop headers. It signs a canonical IP, timestamp, random nonce and SHA-256 scope of method/path/query, bound to the configured origin through an HMAC domain. The assertion expires after 120 seconds and allows five seconds of forward clock skew; synchronize host clocks. Its key and headers are not user-session credentials. They must stay on the trusted internal hop, which is loopback in the supported deployment. Do not log private assertion headers or serve them back to clients. The gateway filters those response headers and preserves normal streaming responses/cookies/status codes.

Next's proxy verifies the actual method and request target before processing protected requests. API/action rate-limit helpers accept only verified assertions, never raw platform headers. A missing assertion fails closed in production. Local development without one uses a fixed development identity rather than trusting arbitrary IP strings. Existing independent hashed-account throttles from AUD-011 remain enforced.

The gateway streams HTTP, bounds requests to 8 MiB and uses a 120-second request/upstream timeout. Individual handlers retain their stricter JSON/upload limits. Oversized declared bodies receive 413; an oversized active stream is rejected or disconnected. The gateway is not a replacement for provider limits, authorization or handler validation.

## Reservation worker

Use `APP_URL` and the same `TRUSTED_PROXY_SECRET` on the supervised reservation worker. For direct private calls, set `CHECKOUT_SWEEP_ORIGIN=http://127.0.0.1:3000` (or the private service's HTTPS origin). It signs each POST's exact target with a fixed service IP and supplies the independent sweep Bearer secret. Do not invent a client Origin or add the expiry endpoint to a broad CSRF exemption list. The worker can also call the canonical public tunnel hostname; the gateway replaces its ingress assertion with its own. The independent sweep authentication/database-target check still applies.

## Reproducible verification

After building and migrating a disposable local `audit_*` database, set `TEST_DATABASE_URL` and run:

```sh
npm test -- --runInBand
npm run test:gateway
npm run smoke:standalone
npm run smoke:runtime
npm run smoke:ingress
```

The native gateway tests use actual local HTTP, HMAC and streaming. The ingress smoke runs the prepared production app and real gateway against the guarded local database and a test-only Redis REST boundary. It checks direct-origin spoof denial, expired/tampered/wrong-method/wrong-query assertions, catalog/RSC/prefetch, canonical role redirects, wrong/missing browser origins, action attempts on asset paths, independent Stripe signature rejection and a shared login budget despite eleven rotating spoofed-IP headers. No production database, actual mail, payment or remote tunnel is used. Deployment/firewall/container and live provider verification must still be performed against the operator's configured test deployment under AUD-044; Docker is unavailable in the current audit environment.

Provider references: [Cloudflare request headers and Worker/Pseudo IPv4 caveats](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [Cloudflare Tunnel connection model](https://developers.cloudflare.com/tunnel/). Installed Next 16.4.3 guides for `proxy`, `skipProxyUrlNormalize` and `serverActions.allowedOrigins` were read before implementation. Next's default action check compares host values and warns rather than rejects a missing Origin; the application's explicit production check additionally enforces the complete configured origin and missing-Origin policy.
