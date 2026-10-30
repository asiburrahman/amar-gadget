import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createIngressGateway } from "../../lib/ingress-gateway.mjs";
import { verifyIngress } from "../../lib/ingress-protocol.cjs";
import { requestHttp as fetch } from "../../scripts/testing/http-request.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const secret = "private-native-gateway-fixture-".repeat(2);
const appOrigin = "https://store.example.invalid";
async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
test("gateway strips spoofed trust, binds target/method, streams bodies/status and filters response headers", async () => {
  const backend = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.writeHead(201, { "Content-Type": "application/json", "x-amar-ingress-signature": "never-expose", "x-middleware-override-headers": "never-expose", Connection: "x-private-hop", "x-private-hop": "private" });
    res.end(JSON.stringify({ ip: verifyIngress({ headers: req.headers, secret, origin: appOrigin, method: req.method, target: req.url }), headers: req.headers, body: Buffer.concat(chunks).toString() }));
  });
  const originUrl = await listen(backend);
  const gateway = createIngressGateway({ secret, appOrigin, originUrl, clientIpMode: "socket" });
  const url = await listen(gateway);
  try {
    const response = await fetch(url + "/api/test?q=space%20value", { method: "POST", headers: { Host: "store.example.invalid", Origin: appOrigin, "x-forwarded-for": "192.0.2.99", "cf-connecting-ip": "192.0.2.98", "x-amar-client-ip": "192.0.2.97", "x-middleware-subrequest": "middleware", "x-forwarded-host": "evil.invalid" }, body: "streamed body" });
    assert.equal(response.status, 201);
    const value = await response.json();
    assert.equal(value.ip, "127.0.0.1"); assert.equal(value.body, "streamed body");
    assert.equal(value.headers.host, "store.example.invalid"); assert.equal(value.headers["x-forwarded-host"], "store.example.invalid");
    for (const header of ["x-forwarded-for", "cf-connecting-ip", "x-middleware-subrequest"]) assert.equal(value.headers[header], undefined);
    for (const header of ["x-amar-ingress-signature", "x-middleware-override-headers", "x-private-hop"]) assert.equal(response.headers.get(header), null);
    assert.equal((await fetch(url + "/", { headers: { Host: "evil.invalid" } })).status, 421);
    assert.equal((await fetch(url + "/", { method: "POST", headers: { Host: "store.example.invalid", "Content-Length": String(8 * 1024 * 1024 + 1) }, body: "x" })).status, 413);
  } finally { await close(gateway); await close(backend); }
});
test("Cloudflare mode accepts only the primary local-tunnel IP and rejects Pseudo IPv4 overwrite", async () => {
  const backend = createServer(async (req, res) => {
    try { for await (const chunk of req) { void chunk; } }
    catch { return; }
    res.end(verifyIngress({ headers: req.headers, secret, origin: appOrigin, method: req.method, target: req.url }) ?? "invalid");
  });
  const originUrl = await listen(backend);
  const gateway = createIngressGateway({ secret, appOrigin, originUrl, clientIpMode: "cloudflare-tunnel" });
  const url = await listen(gateway);
  try {
    const send = (headers) => fetch(url + "/", { headers: { Host: "store.example.invalid", ...headers } });
    for (const headers of [{}, { "cf-connecting-ip": "unknown" }, { "cf-connecting-ip": "192.0.2.1, 192.0.2.2" }]) assert.equal((await send(headers)).status, 400);
    assert.equal(await (await send({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" })).text(), "192.0.2.1");
    assert.equal(await (await send({ "cf-connecting-ip": "2001:0DB8:0:0:0:0:0:1", "cf-connecting-ipv6": "2001:db8::99" })).text(), "2001:db8::1");
    assert.equal(await (await send({ "cf-connecting-ip": "192.0.2.1", "cf-connecting-ipv6": "2001:db8::99" })).text(), "192.0.2.1");
    assert.equal((await send({ "cf-connecting-ip": "240.0.0.1", "cf-connecting-ipv6": "2001:db8::1" })).status, 400);
    // Chunked clients cannot bypass the body cap by omitting Content-Length.
    const status = await new Promise((resolve, reject) => {
      const req = request(url, { method: "POST", headers: { Host: "store.example.invalid", "cf-connecting-ip": "192.0.2.1" } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", (error) => error.code === "ECONNRESET" ? resolve("closed") : reject(error));
      for (let index = 0; index < 129; index++) req.write(Buffer.alloc(65536));
      req.end();
    });
    assert.ok(status === 413 || status === "closed", "Oversized streaming input must be rejected or disconnected");
  } finally { await close(gateway); await close(backend); }
});
test("invalid trust configuration and unavailable backend fail closed", async () => {
  for (const override of [{ secret: "short" }, { appOrigin: "http://public.invalid" }, { originUrl: "https://public.invalid" }, { clientIpMode: "automatic" }]) assert.throws(() => createIngressGateway({ secret, appOrigin, originUrl: "http://127.0.0.1:1", clientIpMode: "socket", ...override }));
  const gateway = createIngressGateway({ secret, appOrigin, originUrl: "http://127.0.0.1:1", clientIpMode: "socket" });
  const url = await listen(gateway);
  try { assert.equal((await fetch(url, { headers: { Host: "store.example.invalid" } })).status, 502); }
  finally { await close(gateway); }
});
for (const [worker, path] of [["checkout-reservations-worker", "/api/internal/checkout/expire"], ["media-cleanup-worker", "/api/internal/media/cleanup"], ["avatar-cleanup-worker", "/api/internal/avatars/cleanup"]]) test(`${worker} sends both a real scoped ingress signature and independent maintenance authentication`, { timeout: 10_000 }, async () => {
  const sweepKey = "independent-private-sweep-fixture-".repeat(2);
  let observed;
  const arrived = new Promise((resolve) => { observed = resolve; });
  const backend = createServer((req, res) => {
    const valid = req.method === "POST" && req.url === path && req.headers.authorization === `Bearer ${sweepKey}` && verifyIngress({ headers: req.headers, secret, origin: appOrigin, method: req.method, target: req.url }) === "127.0.0.1";
    res.writeHead(valid ? 200 : 403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ checked: 0, released: 0, review: 0, errors: 0 }));
    observed(valid);
  });
  const url = await listen(backend);
  const child = spawn(process.execPath, [fileURLToPath(new URL(`../../scripts/${worker}.mjs`, import.meta.url))], { stdio: "ignore", env: { SystemRoot: process.env.SystemRoot, CHECKOUT_SWEEP_ORIGIN: url, MEDIA_CLEANUP_ORIGIN: url, APP_URL: appOrigin, CHECKOUT_SWEEP_SECRET: sweepKey, TRUSTED_PROXY_SECRET: secret } });
  let timer;
  try {
    const failed = new Promise((_, reject) => { child.once("error", reject); child.once("exit", () => reject(new Error("Worker exited before the request"))); timer = setTimeout(() => reject(new Error("Worker request deadline exceeded")), 5000); });
    assert.equal(await Promise.race([arrived, failed]), true);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
    await close(backend);
  }
});
