import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";

// Never migrate/reset an input database. Both migrations and seeds run only
// against the newly owned random database, which is dropped in finally.
let fixture;
let phase = "disposable migration and seed";
function run(script, args, output = "inherit") {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(script), ...args], {
      env: { ...process.env, TEST_DATABASE_URL: fixture.url, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url },
      stdio: ["ignore", output, output],
    });
    child.once("error", () => reject(new Error("Verification process could not start.")));
    child.once("exit", (code) => code === 0 ? done() : reject(new Error("Verification process failed.")));
  });
}
try {
  fixture = await createFinancialSmokeDatabase();
  await run("node_modules/prisma/build/index.js", ["db", "seed"], "ignore");
  await run("node_modules/prisma/build/index.js", ["db", "seed"], "ignore");
  assert.equal(await fixture.db.category.count(), 5);
  assert.equal(await fixture.db.brand.count(), 5);
  assert.equal(await fixture.db.user.count(), 0);
  assert.equal(await fixture.db.product.count(), 0);
  assert.equal(await fixture.db.order.count(), 0);
  console.log("Disposable migrate deploy + twice-idempotent seed: PASS; no login accounts or products seeded.");
  phase = "complete Jest suite with mandatory real database execution";
  await mkdir("test-results", { recursive: true });
  const reportPath = resolve("test-results/jest-results.json");
  await run("node_modules/jest/bin/jest.js", ["--runInBand", "--json", "--outputFile", reportPath]);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.success, true);
  assert.equal(report.numPendingTestSuites, 0, "Database suites must not be skipped in the release gate.");
  assert.equal(report.numPendingTests, 0, "Skipped tests must not make the release gate appear green.");
  assert.ok(report.numPassedTests > 0);
  console.log(JSON.stringify({ disposableDatabase: "PASS", migrationAndSeed: "PASS", noSkippedTests: "PASS", suites: report.numPassedTestSuites, tests: report.numPassedTests }));
} catch {
  console.error(`Isolated verification failed during ${phase}; provider credentials and database URLs withheld.`);
  process.exitCode = 1;
} finally { await fixture?.close(); }
