import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { INVARIANT_MIGRATION } from "./database-invariants-preflight.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";

let phase = "owned baseline database and compiled startup";
async function main() {
  const fixture = await createFinancialSmokeDatabase({ beforeMigration: INVARIANT_MIGRATION });
  let child, redis;
  try {
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    const secret = randomBytes(32).toString("hex");
    child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret }, undefined, { readiness: false });
    // This test intentionally starts on an unavailable schema, so the usual
    // healthy-readiness startup helper cannot be used. Next's banner can
    // precede its accepting listener: establish independent liveness first.
    const deadline = Date.now() + 30_000;
    let listening = false;
    while (Date.now() < deadline && !listening) {
      try {
        const response = await requestHttp(child.origin + "/api/health", { timeout: Math.min(1000, Math.max(1, deadline - Date.now())) });
        const body = await response.json(); listening = response.status === 200 && body.status === "OK" && body.check === "liveness";
      } catch { /* Only the independent startup listener is retried here. */ }
      if (!listening) await delay(100);
    }
    assert.ok(listening, "Compiled liveness must accept requests before testing schema rejection");
    const readiness = async (status, expire = true) => {
      if (expire) await delay(5100);
      const target = "/api/health/ready";
      const response = await requestHttp(child.origin + target, { headers: signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method: "GET", target }) });
      const body = await response.json(); assert.equal(response.status, status); assert.ok(response.headers.get("cache-control").includes("no-store"));
      assert.equal(body.checks.configuration, true); assert.equal(body.checks.redis, true); assert.equal(body.checks.database, status === 200);
      if (status === 503) { assert.equal(body.status, "UNAVAILABLE"); assert.match(body.references.database, /^[a-f0-9-]{36}$/); assert.ok(child.logContains(body.references.database)); }
      const text = JSON.stringify(body);
      for (const withheld of [fixture.url, "User_role_domain", "Order_trackingNumber_key", "pg_constraint", "P2021"]) assert.ok(!text.includes(withheld));
    };
    phase = "older schema rejected despite healthy database TCP and Redis";
    await readiness(503, false);
    phase = "actual CLI upgrade recovers the same compiled process";
    await fixture.deploy(); await readiness(200);
    phase = "missing and unvalidated role protection rejected";
    await fixture.db.$executeRawUnsafe('ALTER TABLE "User" DROP CONSTRAINT "User_role_domain"'); await readiness(503);
    await fixture.db.$executeRawUnsafe(`ALTER TABLE "User" ADD CONSTRAINT "User_role_domain" CHECK(role IN ('USER','MEMBER','ADMIN')) NOT VALID`); await readiness(503);
    await fixture.db.$executeRawUnsafe('ALTER TABLE "User" VALIDATE CONSTRAINT "User_role_domain"'); await readiness(200);
    phase = "same-name unique index on the wrong column rejected";
    await fixture.db.$executeRawUnsafe('DROP INDEX "Order_trackingNumber_key"');
    await fixture.db.$executeRawUnsafe('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"(id)'); await readiness(503);
    await fixture.db.$executeRawUnsafe('DROP INDEX "Order_trackingNumber_key"');
    await fixture.db.$executeRawUnsafe('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"("trackingNumber",(lower(id)))'); await readiness(503);
    await fixture.db.$executeRawUnsafe('DROP INDEX "Order_trackingNumber_key"');
    await fixture.db.$executeRawUnsafe('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"("trackingNumber")'); await readiness(200);
    phase = "retained partial uniqueness cannot disappear behind a migration record";
    for (const [name, definition] of [
      ["Address_one_default_per_user", 'ON "Address"("userId") WHERE "isDefault"=true'],
      ["Review_one_canonical_user_product", 'ON "Review"("userId","productId") WHERE "isCanonical"'],
    ]) {
      await fixture.db.$executeRawUnsafe(`DROP INDEX "${name}"`); await readiness(503);
      await fixture.db.$executeRawUnsafe(`CREATE UNIQUE INDEX "${name}" ${definition}`); await readiness(200);
    }
    return { compiledOldSchemaRejected: "PASS", cliUpgradeRecoveryWithoutRestart: "PASS", missingAndUnvalidatedChecksRejected: "PASS", incorrectTrackingIndexRejected: "PASS", retainedPartialUniquenessRequired: "PASS", safeReadinessReferences: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const diagnostic = error?.code === "ERR_ASSERTION" ? error.message : "Private diagnostic withheld";
  console.error(`Database invariant smoke failed during ${phase}: ${diagnostic}.`); process.exitCode = 1;
});
