// Supervised in-app delivery. No email/provider fallback or fabricated success.
import { setTimeout as sleep } from "node:timers/promises";
import { signIngress, canonicalOrigin, validSecret } from "../lib/ingress-protocol.cjs";
const secret = process.env.CHECKOUT_SWEEP_SECRET;
const endpoint = new URL("/api/internal/notifications/deliver", canonicalOrigin(process.env.CHECKOUT_SWEEP_ORIGIN));
if (!secret || Buffer.byteLength(secret) < 32 || secret.length > 4096) throw new Error("Set CHECKOUT_SWEEP_SECRET (at least 32 bytes)");
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("The worker requires HTTPS or loopback");
const ingressSecret = process.env.TRUSTED_PROXY_SECRET, applicationOrigin = canonicalOrigin(process.env.APP_URL);
if (!validSecret(ingressSecret) || ingressSecret === secret) throw new Error("Set a distinct TRUSTED_PROXY_SECRET for the trusted worker");
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop.abort());
while (!stop.signal.aborted) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${secret}`, ...signIngress({ secret: ingressSecret, origin: applicationOrigin, ip: "127.0.0.1", method: "POST", target: endpoint.pathname + endpoint.search }) }, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(45_000)]), redirect: "error" });
    if (!response.ok) throw new Error("Notification delivery endpoint did not confirm the run");
    const result = await response.json();
    const fields = ["checked", "delivered", "progressed", "inserted", "skipped", "deferred", "dead"];
    if (!fields.every((field) => Number.isSafeInteger(result[field]) && result[field] >= 0)) throw new Error("Notification worker response could not be confirmed");
    console.log(JSON.stringify({ event: "notification_delivery", ...Object.fromEntries(fields.map((field) => [field, result[field]])) }));
    if (result.dead || result.deferred) console.error("Notification delivery requires operator attention; inspect the administrator queue");
  } catch { if (!stop.signal.aborted) console.error("Notification worker request failed; durable delivery will be retried"); }
  try { await sleep(10_000, undefined, { signal: stop.signal }); } catch { /* Graceful shutdown. */ }
}
