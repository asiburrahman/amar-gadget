import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

// A private source-workspace .env can be explicitly loaded for local start.
// Deployed standalone artifacts contain no dotenv file and use injected env.
const args = existsSync(".env") ? [`--env-file=${resolve(".env")}`] : [];
const child = spawn(process.execPath, [...args, resolve(".next/standalone/start.cjs")], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Production launcher failed."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
