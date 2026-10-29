import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

it.each([false, true])("loads only the explicit runtime workspace env when present and preserves the child exit code: %s", (useFile) => {
  const root = mkdtempSync(join(tmpdir(), "amar-launcher-test-"));
  try {
    mkdirSync(join(root, ".next", "standalone"), { recursive: true });
    // Test-only executable verifies launcher delegation; the real compiled
    // startup/application paths are exercised by both standalone smokes.
    writeFileSync(join(root, ".next", "standalone", "start.cjs"), 'process.stdout.write(String(process.env.LAUNCHER_TEST_VALUE === "isolated-runtime-value")); process.exitCode = 7;');
    if (useFile) writeFileSync(join(root, ".env"), "LAUNCHER_TEST_VALUE=isolated-runtime-value\n");
    const env = { ...process.env };
    delete env.LAUNCHER_TEST_VALUE;
    if (!useFile) env.LAUNCHER_TEST_VALUE = "isolated-runtime-value";
    const result = spawnSync(process.execPath, [resolve("scripts/start-production.mjs")], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(7); expect(result.stdout).toBe("true");
    expect(result.stderr).toBe("");
  } finally {
    // Only this test's known temporary workspace; never a computed repo path.
    if (!root.startsWith(join(tmpdir(), "amar-launcher-test-"))) throw new Error("Unexpected launcher test directory");
    rmSync(root, { recursive: true, force: true });
  }
});
