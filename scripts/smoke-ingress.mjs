import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createIngressGateway } from "../lib/ingress-gateway.mjs";
import { signIngress, names } from "../lib/ingress-protocol.cjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
import { computeCacheBustingSearchParam } from "next/dist/shared/lib/router/utils/cache-busting-search-param.js";

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Configure the isolated local audit_* TEST_DATABASE_URL.");
  const secret = randomBytes(32).toString("hex");
  const appOrigin = "https://store.example.invalid";
  const redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
  let child, gateway;
  try {
    child = await startStandaloneFixture(databaseUrl, redis, { APP_URL: appOrigin, TRUSTED_PROXY_SECRET: secret });
    gateway = createIngressGateway({ secret, appOrigin, originUrl: child.origin, clientIpMode: "socket" });
    await new Promise((resolve, reject) => { gateway.once("error", reject); gateway.listen(0, "127.0.0.1", resolve); });
    const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
    const direct = (path, options) => requestHttp(child.origin + path, options);
    const through = (path, options = {}) => requestHttp(gatewayUrl + path, { ...options, headers: { Host: "store.example.invalid", ...options.headers } });
    const sign = (method, target, now) => signIngress({ secret, origin: appOrigin, ip: "192.0.2.1", method, target, now });
    // Plain probes/static assets remain intentionally public. No hosted service is called.
    assert.equal((await direct("/api/health")).status, 200);
    assert.equal((await direct("/file.svg")).status, 200);
    for (const path of ["/api/products", "/products", "/api/auth/me", "/admin/orders"]) {
      for (const headers of [{}, { "cf-connecting-ip": "192.0.2.99", "x-forwarded-for": "192.0.2.98", "x-vercel-forwarded-for": "192.0.2.97", "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" }]) assert.equal((await direct(path, { headers })).status, 403);
    }
    const target = "/api/products?search=ingress-fixture-no-results";
    for (const assertion of [sign("GET", target, Date.now() - 121_000), sign("POST", target), sign("GET", "/api/products?search=different"), { ...sign("GET", target), [names.ip]: "192.0.2.200" }]) assert.equal((await direct(target, { headers: assertion })).status, 403);
    assert.equal((await through(target)).status, 200);
    // Match the installed client router's actual header/hash protocol rather
    // than disabling Next's cache-poisoning protection for a synthetic request.
    const rscHash = await computeCacheBustingSearchParam("1", undefined, undefined, undefined);
    const rsc = await through(`/products?search=ingress-fixture-no-results&_rsc=${rscHash}`, { headers: { RSC: "1", "Next-Router-Prefetch": "1" } });
    assert.equal(rsc.status, 200);
    assert.match(rsc.headers.get("content-type"), /text\/x-component/);
    const admin = await through("/admin/orders");
    assert.equal(admin.status, 307); assert.equal(admin.headers.get("location"), appOrigin + "/login");
    for (const origin of [undefined, "null", "https://evil.invalid", "https://store.example.invalid:444"]) {
      const headers = { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) };
      assert.equal((await through("/api/auth/login", { method: "POST", headers, body: "{}" })).status, 403);
      assert.equal((await through("/file.svg", { method: "POST", headers: { ...headers, "Next-Action": "invalid-action" }, body: "[]" })).status, 403);
    }
    // A signed external webhook still needs its own Stripe signature.
    assert.equal((await through("/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
    // Distinct account identities avoid the separate account budget. Rotating
    // caller forwarding headers cannot create new socket-IP login buckets.
    for (let index = 0; index < 11; index++) {
      const response = await through("/api/auth/login", { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json", "cf-connecting-ip": `192.0.2.${index + 1}`, "x-forwarded-for": `198.51.100.${index + 1}`, "x-vercel-forwarded-for": `203.0.113.${index + 1}` }, body: JSON.stringify({ email: `ingress-${index}@example.invalid`, password: "Wrong fixture password!123" }) });
      assert.equal(response.status, index < 10 ? 401 : 429);
      for (const header of Object.values(names)) assert.equal(response.headers.get(header), null);
    }
    return { directOriginSpoofDenied: "PASS", scopeAndExpiryEnforced: "PASS", authenticatedGatewayCatalog: "PASS", rscAndPrefetch: "PASS", canonicalRoleRedirect: "PASS", browserOriginEnforced: "PASS", actionAssetBypassDenied: "PASS", stripeSignatureStillRequired: "PASS", spoofedIpCannotRotateLoginBudget: "PASS", privateAssertionNotExposed: "PASS" };
  } finally {
    if (gateway) { gateway.closeAllConnections(); await new Promise((resolve) => gateway.close(resolve)); }
    await child?.stop(); await redis.close();
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const safe = error?.code === "ERR_ASSERTION" ? `assertion failed (actual=${error.actual}, expected=${error.expected})` : "check the isolated database, prepared artifact and fixture lifecycle";
  console.error(`Ingress HTTP smoke failed: ${safe}. Private child output was not published.`); process.exitCode = 1;
});
