import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startDatabaseTcpFixture } from "./testing/database-tcp-fixture.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "isolated database setup";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis, proxy;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url);
    const user = await db.user.create({ data: { email: `${randomUUID()}@outage.example.invalid`, password: await hashPassword(password), isVerified: true, role: "MEMBER", sellerStatus: "APPROVED" } });
    const category = await db.category.create({ data: { name: "Actual outage category", slug: randomUUID() } });
    const product = await db.product.create({ data: { name: "Actual isolated product", slug: randomUUID(), categoryId: category.id, sellerId: user.id, price: 100, stock: 5, status: "APPROVED" } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); proxy = await startDatabaseTcpFixture(fixture.url);
    child = await startStandaloneFixture(proxy.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target }), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const ready = async (expected, failedCheck) => {
      const response = await send("/api/health/ready"), body = await response.json(); assert.equal(response.status, expected, `Unexpected readiness status; checks=${JSON.stringify(body.checks)}, timeoutLog=${child.logContains('"category":"TIMEOUT"')}`); assert.ok(response.headers.get("cache-control").includes("no-store"));
      if (failedCheck) { assert.equal(body.checks[failedCheck], false); assert.match(body.references[failedCheck], /^[a-f0-9-]{36}$/); assert.ok(child.logContains(body.references[failedCheck])); }
      return body;
    };
    phase = "healthy compiled readiness";
    await ready(200);
    phase = "real compiled password login";
    const login = await send("/api/auth/login", "POST", { email: user.email, password }); assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    phase = "healthy compiled session and visible product";
    assert.equal((await send("/api/auth/me", "GET", undefined, cookie)).status, 200);
    const visibleBefore = await send(`/products/${product.slug}`); assert.equal(visibleBefore.status, 200); assert.ok((await visibleBefore.text()).includes(product.name));
    phase = "actual critical-table outage despite a present migration record";
    await db.$executeRawUnsafe('ALTER TABLE "Product" RENAME TO "FixtureUnavailableProduct"');
    try {
      await delay(5100); await ready(503, "database"); assert.equal((await send("/api/health")).status, 200);
      const unavailable = await send("/api/products"), body = await unavailable.json(); assert.equal(unavailable.status, 503); assert.equal(body.reference, unavailable.headers.get("x-error-reference")); assert.ok(child.logContains(body.reference)); assert.ok(!Object.hasOwn(body, "products"));
      phase = "actual compiled page-boundary digest and redacted server reference";
      const target = `/products/${product.slug}`;
      let page = await send(target, "GET", undefined, undefined, { RSC: "1" });
      if (page.status === 307) { const location = new URL(page.headers.get("location"), child.origin); assert.equal(location.pathname, target); assert.equal(location.origin, child.origin); page = await send(location.pathname + location.search, "GET", undefined, undefined, { RSC: "1" }); }
      assert.ok([200, 500].includes(page.status)); const text = await page.text();
      const references = [...text.matchAll(/"digest":"([a-f0-9]{8}-[a-f0-9-]{27})"/g)].map((match) => match[1]);
      assert.ok(references.length > 0); assert.ok(references.some((reference) => child.logContains(reference))); assert.ok(!text.includes("FixtureUnavailableProduct")); assert.ok(!child.logContains("FixtureUnavailableProduct"));
    } finally { await db.$executeRawUnsafe('ALTER TABLE "FixtureUnavailableProduct" RENAME TO "Product"'); }
    phase = "table recovery without process restart";
    await delay(5100); await ready(200); assert.equal((await send("/api/products")).status, 200);
    const visibleAfter = await send(`/products/${product.slug}`); assert.equal(visibleAfter.status, 200); assert.ok((await visibleAfter.text()).includes(product.name));
    phase = "actual database TCP interruption and session uncertainty";
    proxy.setAvailable(false); await delay(5100); await ready(503, "database");
    const session = await send("/api/auth/me", "GET", undefined, cookie), failed = await session.json(); assert.equal(session.status, 503); assert.ok(!Object.hasOwn(failed, "user")); assert.equal(failed.reference, session.headers.get("x-error-reference")); assert.ok(child.logContains(failed.reference));
    assert.equal((await send("/api/health")).status, 200);
    const invalid = await send("/api/auth/me", "GET", undefined, "auth_token=invalid"); assert.equal(invalid.status, 200); assert.deepEqual(await invalid.json(), { success: false, user: null });
    phase = "TCP recovery with the original session cookie";
    proxy.setAvailable(true); await delay(5100); await ready(200);
    const recovered = await send("/api/auth/me", "GET", undefined, cookie); assert.equal(recovered.status, 200); assert.equal((await recovered.json()).user.id, user.id);
    phase = "actual stalled database connection and bounded readiness timeout";
    proxy.setStalled(true); await delay(5100); const timeoutStart = Date.now(); await ready(503, "database"); assert.ok(Date.now() - timeoutStart < 5000);
    proxy.setStalled(false); await delay(5100); await ready(200);
    phase = "actual Redis-boundary outage and bounded readiness recovery";
    redis.setAvailable(false); await delay(5100); await ready(503, "redis"); assert.equal((await send("/api/health")).status, 200);
    redis.setAvailable(true); await delay(5100); await ready(200);
    return { criticalTableDriftAndRecovery: "PASS", compiledErrorDigestLogCorrelationAndRedaction: "PASS", databaseTcpOutageAndSessionRecovery: "PASS", stalledConnectionBoundedTimeoutAndRecovery: "PASS", redisOutageRecoveryAndIndependentLiveness: "PASS" };
  } finally { await child?.stop(); await proxy?.close(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`Reliability outage smoke failed during ${phase}: ${error?.code === "ERR_ASSERTION" ? error.message : "private diagnostic withheld"}. Private server output and credentials were not published.`); process.exitCode = 1; });
