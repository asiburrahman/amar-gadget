import { setTimeout as delay } from "node:timers/promises";
import { requestHttp } from "./http-request.mjs";

// A Next startup banner precedes dependency initialization. Consumers must
// distinguish an accepting listener from a usable database/schema/Redis stack.
export async function waitForReadiness(origin, { timeout = 30_000, interval = 250, alive = () => true } = {}) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash) throw new Error("Readiness probes require an exact loopback fixture origin.");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error("Standalone fixture exited before dependency readiness.");
    try {
      const response = await requestHttp(origin + "/api/health/ready", { timeout: Math.min(5000, Math.max(1, deadline - Date.now())) });
      const result = await response.json();
      if (response.status === 200 && result.status === "READY" && result.checks?.configuration === true && result.checks?.database === true && result.checks?.redis === true) return;
    } catch { /* Refused startup sockets, malformed responses and 503s retry within the deadline. */ }
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
  throw new Error("Standalone fixture dependency readiness deadline exceeded; private responses were withheld.");
}
