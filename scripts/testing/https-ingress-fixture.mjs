import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { makeCertificate } from "./smtp-fixture.mjs";
import { createIngressGateway } from "../../lib/ingress-gateway.mjs";

// Real TLS and the production ingress handler preserve Secure-cookie behavior
// across browsers. Plain loopback HTTP is not equivalent in WebKit.
export async function startHttpsIngressFixture() {
  const directory = await mkdtemp(join(tmpdir(), "amar-browser-tls-"));
  let server, gateway, storage;
  const sockets = new Set();
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server?.listening) await new Promise((done) => server.close(done));
    const absolute = resolve(directory), actual = await realpath(directory), parent = await realpath(tmpdir());
    const comparable = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (comparable(actual) !== comparable(absolute) || comparable(dirname(actual)) !== comparable(parent) || !/^amar-browser-tls-[A-Za-z0-9]+$/.test(basename(actual))) throw new Error("Refusing to remove an unexpected browser TLS fixture directory.");
    await rm(absolute, { recursive: true, force: false });
  };
  try {
    const certificate = await makeCertificate(directory);
    server = createServer({ key: certificate.key, cert: certificate.cert, minVersion: "TLSv1.2" }, (request, response) => {
      const media = request.url.startsWith("/__fixture_media/");
      if (storage && (media || request.url.startsWith("/__fixture_storage/"))) {
        const prefix = media ? "/__fixture_media" : "/__fixture_storage";
        const target = request.url.slice(prefix.length);
        const cors = { "access-control-allow-origin": `https://127.0.0.1:${server.address().port}`, "access-control-allow-methods": "GET, HEAD, PUT", "access-control-allow-headers": "*" };
        if (request.method === "OPTIONS") { response.writeHead(204, cors); response.end(); return; }
        // Continue the original browser request over the network. WebKit's
        // interception API cannot expose a File-backed XHR body to JavaScript;
        // rebuilding it from postDataBuffer would silently upload zero bytes.
        const upstream = httpRequest(storage + target, { method: request.method, headers: { ...request.headers, host: media ? "cdn.media.example.invalid" : `fixture-media.${"a".repeat(32)}.r2.cloudflarestorage.com` }, timeout: 15_000 }, (result) => {
          response.writeHead(result.statusCode, { ...result.headers, ...cors });
          result.on("error", () => response.destroy());
          result.pipe(response);
        });
        upstream.on("error", () => { if (response.headersSent) response.destroy(); else { response.writeHead(502, cors); response.end(); } });
        upstream.on("timeout", () => upstream.destroy());
        request.on("aborted", () => upstream.destroy());
        request.pipe(upstream);
      } else if (gateway) gateway.emit("request", request, response);
      else { response.writeHead(503); response.end("Fixture backend is not attached."); }
    });
    server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
    const origin = `https://127.0.0.1:${server.address().port}`;
    return { origin, close, attach: (originUrl, secret, storageEndpoint) => {
      if (gateway) throw new Error("Browser ingress already attached.");
      const endpoint = new URL(storageEndpoint);
      if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("Browser storage requires an exact loopback endpoint.");
      storage = endpoint.origin;
      gateway = createIngressGateway({ secret, appOrigin: origin, originUrl, clientIpMode: "socket" });
    } };
  } catch (error) { await close(); throw error; }
}
