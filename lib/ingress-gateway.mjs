import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { canonicalIp, canonicalOrigin, canonicalTarget, signIngress, validSecret } from "./ingress-protocol.cjs";

const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function cleaned(headers) {
  const connectionNames = String(headers.connection ?? "").toLowerCase().split(",").map((value) => value.trim());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !hopHeaders.has(name) && !connectionNames.includes(name) && !name.startsWith("x-amar-") && !name.startsWith("x-middleware-") && !["forwarded", "cf-connecting-ip", "cf-connecting-ipv6", "x-real-ip", "x-forwarded-for", "x-vercel-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-request-id"].includes(name)));
}

/** Real loopback ingress gateway. Only a local tunnel/host peer can connect.
 * @param {{secret:string, appOrigin:string, originUrl:string, clientIpMode:"socket"|"cloudflare-tunnel"}} options */
export function createIngressGateway(options) {
  if (!validSecret(options.secret)) throw new Error("Invalid TRUSTED_PROXY_SECRET");
  const appOrigin = canonicalOrigin(options.appOrigin);
  const backend = new URL(options.originUrl);
  if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash || !["localhost", "127.0.0.1", "[::1]", "app"].includes(backend.hostname)) throw new Error("Origin URL must identify the local/private app service");
  if (!["socket", "cloudflare-tunnel"].includes(options.clientIpMode)) throw new Error("Select an explicit gateway IP source");
  const maximumBody = 8 * 1024 * 1024;
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 120_000, maxHeaderSize: 32768 }, (incoming, outgoing) => {
    const fail = (status) => {
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      outgoing.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
      outgoing.end(JSON.stringify({ error: "Ingress request rejected." }));
    };
    const peer = canonicalIp(incoming.socket.remoteAddress);
    if (!peer || !["127.0.0.1", "::1"].includes(peer)) { fail(403); return; }
    let target, identity, assertion;
    try {
      if (incoming.headers.host !== new URL(appOrigin).host) { fail(421); return; }
      target = canonicalTarget(incoming.url ?? "/");
      identity = options.clientIpMode === "socket" ? peer : canonicalIp(incoming.headers["cf-connecting-ip"]);
      // Require Cloudflare Pseudo IPv4 Off/Add Header. An auxiliary IPv6
      // header is not independent authority when that feature is disabled.
      if (!identity || (options.clientIpMode === "cloudflare-tunnel" && /^\d+\./.test(identity) && Number(identity.split(".")[0]) >= 240)) { fail(400); return; }
      assertion = signIngress({ secret: options.secret, origin: appOrigin, ip: identity, method: incoming.method ?? "GET", target });
    } catch { fail(400); return; }
    if (Number(incoming.headers["content-length"]) > maximumBody) { fail(413); incoming.resume(); return; }
    const headers = { ...cleaned(incoming.headers), ...assertion, host: new URL(appOrigin).host, "x-forwarded-host": new URL(appOrigin).host, "x-forwarded-proto": new URL(appOrigin).protocol.slice(0, -1), "x-request-id": assertion["x-amar-ingress-nonce"] };
    const send = backend.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = send(new URL(target, backend), { method: incoming.method, headers, timeout: 120_000 }, (response) => {
      if (outgoing.writableEnded) { response.destroy(); return; }
      const connectionNames = String(response.headers.connection ?? "").toLowerCase().split(",").map((value) => value.trim());
      const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !hopHeaders.has(name) && !connectionNames.includes(name) && !name.startsWith("x-amar-") && !name.startsWith("x-middleware-")));
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      response.on("error", () => outgoing.destroy());
      response.pipe(outgoing);
    });
    let received = 0, overLimit = false;
    incoming.on("data", (chunk) => {
      received += chunk.length;
      if (received > maximumBody && !overLimit) {
        overLimit = true; incoming.unpipe(upstream); upstream.destroy();
        if (!outgoing.writableEnded) fail(413);
        if (outgoing.writableFinished) incoming.destroy();
        else outgoing.once("finish", () => incoming.destroy());
      }
    });
    incoming.on("aborted", () => upstream.destroy());
    incoming.on("error", () => upstream.destroy());
    outgoing.on("close", () => { if (!outgoing.writableFinished) upstream.destroy(); });
    upstream.on("timeout", () => { upstream.destroy(); if (!outgoing.writableEnded) fail(504); });
    upstream.on("error", () => { if (!outgoing.writableEnded) fail(502); });
    incoming.pipe(upstream);
  });
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  server.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n"));
  return server;
}
