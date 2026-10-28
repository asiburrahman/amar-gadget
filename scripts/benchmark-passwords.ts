import { randomBytes } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { hashPassword, verifyPassword } from "../lib/password";

async function main() {
  const password = randomBytes(32).toString("hex");
  const existing = await hashPassword(password);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let peakRss = process.memoryUsage().rss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 5);
  const hashMs: number[] = [], verifyMs: number[] = [];
  try {
    for (let sample = 0; sample < 5; sample++) {
      let start = performance.now();
      await hashPassword(password); hashMs.push(performance.now() - start);
      start = performance.now();
      if (!(await verifyPassword(password, existing))) throw new Error("Password verification failed.");
      verifyMs.push(performance.now() - start);
    }
    const concurrentStart = performance.now();
    await Promise.all(Array.from({ length: 4 }, () => hashPassword(password)));
    const round = (value: number) => Math.round(value * 10) / 10;
    const stats = (values: number[]) => ({ minMs: round(Math.min(...values)), meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length), maxMs: round(Math.max(...values)) });
    console.log(JSON.stringify({ node: process.version, platform: process.platform, samples: 5, parameters: { N: 65_536, r: 8, p: 2, maxActive: 2, maxQueued: 16, queueTimeoutMs: 5000 }, hash: stats(hashMs), verify: stats(verifyMs), fourConcurrentMs: round(performance.now() - concurrentStart), processPeakRssMiB: round(peakRss / 1024 / 1024), eventLoopDelayMaxMs: round(delay.max / 1e6) }, null, 2));
  } finally { clearInterval(timer); delay.disable(); }
}
main().catch(() => { console.error("Password workload benchmark failed."); process.exitCode = 1; });
