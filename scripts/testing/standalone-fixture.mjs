import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runtimeFixtureEnvironment } from "./runtime-fixture.mjs";

export async function startStandaloneFixture(databaseUrl, redis, overrides = {}, expectedFailureField) {
  const probe = createServer();
  await new Promise((resolveListen, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolveListen); });
  const origin = `http://127.0.0.1:${probe.address().port}`;
  await new Promise((resolveClose) => probe.close(resolveClose));
  const child = spawn(process.execPath, [resolve(".next/standalone/start.cjs")], { stdio: ["ignore", "pipe", "pipe"], env: { ...runtimeFixtureEnvironment(databaseUrl, origin, redis), ...overrides } });
  let output = "", failed = false;
  const collect = (chunk) => { output = (output + chunk.toString()).slice(-8192); };
  child.stdout.on("data", collect); child.stderr.on("data", collect); child.on("error", () => { failed = true; });
  const diagnostics = () => ({
    codes: [...new Set(output.match(/\b(?:ERR_[A-Z0-9_]+|P\d{4})\b/g) ?? [])],
    sharp: /sharp/i.test(output), missingModule: /Cannot find module|module not found/i.test(output),
    actionReference: /Failed to find Server Action|Could not find.*manifest/i.test(output),
    serialization: /Only plain objects|cannot be serialized|not serializable/i.test(output),
    requestContext: /outside a request scope|requestAsyncStorage|request store/i.test(output),
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(5000, undefined, { ref: false })]);
    }
  };
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (failed) throw new Error("Standalone fixture could not start.");
      if (child.exitCode !== null) {
        if (expectedFailureField && child.exitCode !== 0 && !output.includes("Ready") && output.includes("Invalid runtime configuration") && output.includes(expectedFailureField)) return { origin, stop, rejected: true };
        throw new Error(`Standalone fixture exited unexpectedly (exit=${child.exitCode}, configurationMarker=${output.includes("Invalid runtime configuration")}, fieldMarker=${expectedFailureField ? output.includes(expectedFailureField) : false}); private output was not published.`);
      }
      if (output.includes("Ready")) {
        // This installed Next version prints its banner before loading config.
        // A banner cannot prove that invalid instrumentation was accepted.
        if (!expectedFailureField) return { origin, stop, rejected: false, diagnostics };
      }
      await delay(100);
    }
    throw new Error("Standalone fixture startup deadline exceeded.");
  } catch (error) { await stop(); throw error; }
}
