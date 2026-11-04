import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { waitForReadiness } from "../../scripts/testing/wait-for-readiness.mjs";

async function listener(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("startup 503 and a false healthy envelope cannot pass dependency readiness", async () => {
  let requests = 0;
  await listener((req, res) => {
    assert.equal(req.url, "/api/health/ready");
    requests++;
    res.writeHead(requests === 1 ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "READY", checks: { configuration: true, database: requests > 2, redis: true } }));
  }, async (origin) => { await waitForReadiness(origin, { interval: 5, timeout: 2000 }); assert.equal(requests, 3); });
});

test("bounded outage failure withholds private response data", async () => {
  await listener((req, res) => { res.writeHead(503); res.end("PRIVATE_FIXTURE_DIAGNOSTIC"); }, async (origin) => {
    await assert.rejects(waitForReadiness(origin, { timeout: 80, interval: 5 }), (error) => /readiness deadline/.test(error.message) && !error.message.includes("PRIVATE_FIXTURE"));
  });
});

test("dead child and remote targets fail without probing unrelated services", async () => {
  await assert.rejects(waitForReadiness("http://127.0.0.1:1", { alive: () => false }), /exited before dependency readiness/);
  await assert.rejects(waitForReadiness("https://example.com"), /loopback fixture/);
});
