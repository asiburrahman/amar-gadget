// Run as a separate supervised process. No fake provider or success fallback.
import { setTimeout as sleep } from "node:timers/promises";
import { signIngress, canonicalOrigin, validSecret } from "../lib/ingress-protocol.cjs";

const secret = process.env.CHECKOUT_SWEEP_SECRET;
const endpoint = new URL("/api/internal/checkout/expire", canonicalOrigin(process.env.CHECKOUT_SWEEP_ORIGIN));
if (!secret || Buffer.byteLength(secret) < 32 || secret.length > 4096) throw new Error("Set CHECKOUT_SWEEP_SECRET (at least 32 bytes)");
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("The worker requires HTTPS or loopback");
const ingressSecret = process.env.TRUSTED_PROXY_SECRET;
const applicationOrigin = canonicalOrigin(process.env.APP_URL);
if (!validSecret(ingressSecret) || ingressSecret === secret) throw new Error("Set a distinct TRUSTED_PROXY_SECRET for the trusted worker");
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop.abort());
while (!stop.signal.aborted) {
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { authorization: `Bearer ${secret}`, ...signIngress({ secret: ingressSecret, origin: applicationOrigin, ip: "127.0.0.1", method: "POST", target: endpoint.pathname + endpoint.search }) },
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(45_000)]), redirect: "error",
    });
    if (!response.ok) throw new Error(`Worker endpoint returned ${response.status}`);
    const result = await response.json();
    console.log(JSON.stringify({ event: "checkout_reservation_sweep", ...result }));
    if (result.review || result.errors) console.error("Reservation sweep requires operator attention");
  } catch {
    if (!stop.signal.aborted) console.error("Reservation worker request failed; will retry in 60 seconds");
  }
  try { await sleep(60_000, undefined, { signal: stop.signal }); } catch { /* Graceful shutdown. */ }
}
