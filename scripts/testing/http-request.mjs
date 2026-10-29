import { request } from "node:http";

// Native HTTP preserves the explicit canonical Host when connecting to a
// loopback gateway. Node fetch can replace Host with the connection URL.
export function requestHttp(url, { method = "GET", headers = {}, body, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    // Node does not implicitly frame a DELETE body as it does a POST body.
    // Preserve intentional test lengths/stream framing; otherwise send the
    // exact byte count for every method so JSON bodies reach real handlers.
    if (body !== undefined && body !== null && !Object.keys(requestHeaders).some((name) => ["content-length", "transfer-encoding"].includes(name.toLowerCase()))) requestHeaders["Content-Length"] = String(Buffer.byteLength(body));
    const req = request(url, { method, headers: requestHeaders, timeout }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) responseHeaders.append(name, item);
        resolve(new Response(method === "HEAD" || [204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Local HTTP fixture timeout")));
    req.end(body);
  });
}
