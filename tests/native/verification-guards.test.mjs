import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

test("mandatory database gate rejects unsafe targets without echoing credentials", async () => {
  for (const input of ["invalid-PRIVATE_CREDENTIAL_MARKER", "postgresql://user:PRIVATE_CREDENTIAL_MARKER@remote.example.invalid/audit_external", "postgresql://user:PRIVATE_CREDENTIAL_MARKER@127.0.0.1:1/production"]) {
    const result = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve("scripts/verify-isolated-tests.mjs")], { env: { ...process.env, TEST_DATABASE_URL: input }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => done({ code, output }));
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /Isolated verification failed/);
    assert.ok(!result.output.includes("PRIVATE_CREDENTIAL_MARKER"));
  }
});
