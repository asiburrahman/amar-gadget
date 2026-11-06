import { setTimeout as sleep } from "node:timers/promises";
import { signIngress, canonicalOrigin, validSecret } from "../lib/ingress-protocol.cjs";
const secret = process.env.CHECKOUT_SWEEP_SECRET;
const endpoint = new URL("/api/internal/newsletter/deliver", canonicalOrigin(process.env.CHECKOUT_SWEEP_ORIGIN));
if (!secret || Buffer.byteLength(secret) < 32 || secret.length > 4096) throw new Error("Set CHECKOUT_SWEEP_SECRET with at least 32 bytes");
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("The newsletter worker requires HTTPS or loopback");
const ingressSecret = process.env.TRUSTED_PROXY_SECRET, applicationOrigin = canonicalOrigin(process.env.APP_URL);
if (!validSecret(ingressSecret) || ingressSecret === secret) throw new Error("Set a distinct TRUSTED_PROXY_SECRET for trusted ingress");
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop.abort());
while (!stop.signal.aborted) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${secret}`, ...signIngress({ secret: ingressSecret, origin: applicationOrigin, ip: "127.0.0.1", method: "POST", target: endpoint.pathname + endpoint.search }) }, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(45_000)]), redirect: "error" });
    if (!response.ok) throw new Error("Newsletter worker did not confirm its run");
    const result = await response.json(), fields = ["examined", "delivered", "deferred", "failed"];
    if (!fields.every((field) => Number.isSafeInteger(result[field]) && result[field] >= 0 && result[field] <= 1) || result.delivered + result.deferred + result.failed !== result.examined) throw new Error("Newsletter worker counters could not be confirmed");
    console.log(JSON.stringify({ event: "newsletter_delivery", ...Object.fromEntries(fields.map((field) => [field, result[field]])) }));
    if (result.failed) console.error("Newsletter delivery needs operator review; inspect the private delivery queue");
  } catch { if (!stop.signal.aborted) console.error("Newsletter worker request failed; durable requests remain eligible for retry"); }
  try { await sleep(10_000, undefined, { signal: stop.signal }); } catch { /* Supervisor shutdown. */ }
}
