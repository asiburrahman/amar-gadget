// Document replacement can make WebKit report an aborted same-origin fetch as
// pageerror. Recovery is allowed only for the original captured read request.
// Never convert a POST to GET or replay an arbitrary state-changing request.
export const BROWSER_READS_KEY = "__amar_audit_browser_reads_v1";

/** Serialized by Playwright before application scripts execute. Some aborted
 * WebKit fetches never emit a protocol request event, so preserve safe metadata
 * before dispatch, across same-origin document replacements. Never record a
 * credential/mutation body or change the native fetch promise. */
export function installBrowserReadCapture({ key }) {
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input), location.href);
      const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
      if (url.origin === location.origin && (method === "GET" || (method === "POST" && url.pathname === "/api/cart/guest" && !url.search))) {
        const original = new Headers(init?.headers ?? request?.headers);
        const headers = {};
        for (const name of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url", "content-type"]) {
          if (original.has(name)) headers[name] = original.get(name);
        }
        const body = method === "POST" && typeof init?.body === "string" && init.body.length <= 65_536 ? init.body : null;
        const saved = JSON.parse(sessionStorage.getItem(key) ?? "[]");
        const records = Array.isArray(saved) ? saved : [];
        records.push({ url: url.href, method, headers, body });
        while (records.length > 512 || JSON.stringify(records).length > 2_000_000) records.shift();
        sessionStorage.setItem(key, JSON.stringify(records));
      }
    } catch { /* An unavailable observer cannot grant recovery eligibility. */ }
    return Reflect.apply(nativeFetch, this, [input, init]);
  };
}

export function captureBrowserRead(request, origin) {
  const url = new URL(request.url());
  if (url.origin !== origin) return null;
  const method = request.method(), original = request.headers();
  const headers = {};
  if (method === "GET") {
    for (const name of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url"]) {
      if (original[name]) headers[name] = original[name];
    }
    return { url: url.href, method, headers };
  }
  if (method !== "POST" || url.pathname !== "/api/cart/guest" || url.search ||
    !/^application\/json(?:;|$)/i.test(original["content-type"] ?? "")) return null;
  const body = request.postData();
  if (typeof body !== "string" || body.length > 65_536) return null;
  try { JSON.parse(body); } catch { return null; }
  return { url: url.href, method, headers: { "Content-Type": "application/json" }, body };
}

export function sameOriginWebKitDiagnostic(error, origin) {
  const match = error.name === "Fetch API cannot load https"
    ? error.message.match(/^\/{1,2}(127\.0\.0\.1:\d+\/\S+) due to access control checks\.$/) : null;
  if (!match) return null;
  try {
    const target = new URL(`https://${match[1]}`);
    return target.origin === origin ? target.href : null;
  } catch { return null; }
}
