// Run as a separate supervised process against the authenticated private app.
import { setTimeout as sleep } from "node:timers/promises";
import { signIngress, canonicalOrigin, validSecret } from "../lib/ingress-protocol.cjs";
const secret = process.env.CHECKOUT_SWEEP_SECRET, ingressSecret = process.env.TRUSTED_PROXY_SECRET;
const applicationOrigin = canonicalOrigin(process.env.APP_URL);
const endpoint = new URL("/api/internal/media/cleanup", canonicalOrigin(process.env.MEDIA_CLEANUP_ORIGIN));
if (!validSecret(secret) || !validSecret(ingressSecret) || secret === ingressSecret) throw new Error("Configure distinct private maintenance and ingress keys.");
const stop = new AbortController(); for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop.abort());
while (!stop.signal.aborted) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${secret}`, ...signIngress({ secret: ingressSecret, origin: applicationOrigin, ip: "127.0.0.1", method: "POST", target: endpoint.pathname }) }, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(45_000)]), redirect: "error" });
    if (!response.ok) throw new Error();
    const result = await response.json();
    // Publish counts only; never provider exceptions, object URLs or secrets.
    console.log(JSON.stringify({ event: "product_image_cleanup_jobs", inspected: result.inspected, removed: result.removed, retained: result.retained, missing: result.missing, deferred: result.deferred, errors: result.errors }));
    if (result.errors) console.error("Media cleanup jobs need operator attention; they will be retried.");
  } catch { if (!stop.signal.aborted) console.error("Media cleanup worker request failed; will retry in 60 seconds."); }
  try { await sleep(60_000, undefined, { signal: stop.signal }); } catch { /* Graceful shutdown. */ }
}
