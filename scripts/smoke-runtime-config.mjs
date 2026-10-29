import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Set an isolated local audit_* TEST_DATABASE_URL.");
  const entries = await readdir(".next/standalone");
  if (entries.some((name) => name === ".env" || name.startsWith(".env."))) throw new Error("Standalone artifact still contains build-time environment files.");
  const redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
  let child;
  try {
    for (const field of ["JWT_SECRET", "TRUSTED_PROXY_SECRET", "UPSTASH_REDIS_REST_TOKEN", "APP_URL", "R2_PUBLIC_URL"]) {
      child = await startStandaloneFixture(databaseUrl, redis, { [field]: "", SKIP_ENV_VALIDATION: "true" }, field);
      if (!child.rejected) throw new Error("Invalid runtime configuration was not rejected.");
      await child.stop(); child = undefined;
    }
    const unavailableDatabase = new URL(databaseUrl);
    unavailableDatabase.port = "1"; // Closed local port; never a remote database.
    child = await startStandaloneFixture(unavailableDatabase.toString(), redis);
    const live = await fetch(`${child.origin}/api/health`, { signal: AbortSignal.timeout(30_000) });
    const ready = await fetch(`${child.origin}/api/health/ready`, { signal: AbortSignal.timeout(10_000) });
    const result = await ready.json();
    if (live.status !== 200 || ready.status !== 503 || result.checks?.configuration !== true || result.checks?.database !== false || result.checks?.redis !== true) throw new Error("Database outage did not distinguish readiness from process liveness.");
    return { environmentArtifactExcluded: "PASS", invalidJwtRejected: "PASS", missingIngressKeyRejected: "PASS", missingRedisRejected: "PASS", missingOriginRejected: "PASS", missingStorageRejected: "PASS", legacySkipFlagIgnored: "PASS", databaseOutageReadiness: "PASS", processLiveness: "PASS" };
  } finally { await child?.stop(); await redis.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const safe = /^(Standalone fixture|Database outage|Standalone artifact)/.test(error?.message ?? "") ? error.message : "Verify the isolated database, build output and local fixtures.";
  console.error(`Runtime configuration smoke failed: ${safe} Private child output was not published.`); process.exitCode = 1;
});
