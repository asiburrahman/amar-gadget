import { readdir, unlink, cp, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

// Next copies build-time dotenv files into standalone output. Runtime config
// must be injected by the operator, never inherited from the build machine.
const root = resolve(".next/standalone");
const entries = await readdir(root, { withFileTypes: true });
let removed = 0;
for (const entry of entries) {
  if (entry.name !== ".env" && !entry.name.startsWith(".env.")) continue;
  const target = resolve(root, entry.name);
  if (dirname(target) !== root || !entry.isFile()) throw new Error("Unexpected environment artifact; refusing to prepare deployment output.");
  await unlink(target);
  removed++;
}
await cp(resolve("public"), resolve(root, "public"), { recursive: true });
await cp(resolve(".next/static"), resolve(root, ".next/static"), { recursive: true });
for (const file of ["lib/ingress-protocol.cjs", "lib/ingress-gateway.mjs", "scripts/ingress-gateway.mjs", "scripts/checkout-reservations-worker.mjs", "scripts/media-cleanup-worker.mjs"]) {
  await cp(resolve(file), resolve(root, file));
}
// Next's banner precedes configuration loading and its eager prepare can log
// an error without exiting. Validate before opening a production listener.
await writeFile(resolve(root, "start.cjs"), `"use strict";
process.chdir(__dirname);
process.env.NODE_ENV = "production";
delete process.env.NEXT_PHASE;
delete process.env.SKIP_ENV_VALIDATION;
Promise.resolve().then(async () => {
  const instrumentation = require("./.next/server/instrumentation.js");
  if (typeof instrumentation.register !== "function") throw new Error("Missing startup validation");
  await instrumentation.register();
  require("./server.js");
}).catch((error) => {
  const fields = Array.isArray(error?.fields) ? error.fields.filter((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value)) : [];
  console.error(fields.length ? "Invalid runtime configuration: " + fields.join(", ") : "Production startup validation failed.");
  process.exitCode = 1;
});
`);
console.log(`Prepared standalone artifact; removed ${removed} build-time environment file(s).`);
