import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
export async function startRefundStripeFixture(db, token) {
  const refunds = new Map(), keys = new Map(); let creates = 0; const diagnostics = { requests: 0, unauthorized: 0, errors: 0, paths: new Set() };
  const server = createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "Content-Type": "application/json", "Request-Id": `req_${randomUUID()}` }); response.end(JSON.stringify(value)); };
    try {
      diagnostics.requests++;
      if (request.headers["x-audit-fixture-token"] !== token || request.headers.authorization !== "Bearer sk_test_isolated_smoke_only") { diagnostics.unauthorized++; return reply(401, { error: { message: "Invalid isolated SDK credentials" } }); }
      const url = new URL(request.url, "http://localhost");
      diagnostics.paths.add(url.pathname.startsWith("/v1/payment_intents/") ? "payment-intent" : url.pathname.startsWith("/v1/refunds") ? "refund" : "unsupported");
      const match = url.pathname.match(/^\/v1\/payment_intents\/(pi_[a-zA-Z0-9_-]+)$/);
      if (request.method === "GET" && match) {
        const order = await db.order.findFirstOrThrow({ where: { paymentIntentId: match[1] } });
        return reply(200, { id: match[1], object: "payment_intent", status: "succeeded", currency: "bdt", amount_received: Math.round(Number(order.total) * 100), metadata: { orderId: order.id }, latest_charge: { id: `ch_${match[1]}`, paid: true, disputed: false, currency: "bdt", payment_intent: match[1] } });
      }
      if (request.method === "GET" && url.pathname === "/v1/refunds") return reply(200, { object: "list", data: [...refunds.values()].filter((row) => row.payment_intent === url.searchParams.get("payment_intent")), has_more: false, url: "/v1/refunds" });
      if (request.method === "GET" && url.pathname.startsWith("/v1/refunds/")) { const row = refunds.get(url.pathname.split("/").pop()); return reply(row ? 200 : 404, row || { error: { message: "Missing isolated refund" } }); }
      if (request.method === "POST" && url.pathname === "/v1/refunds") {
        let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 8192) return reply(413, { error: { message: "Oversized provider payload" } }); }
        const fields = new URLSearchParams(body), key = request.headers["idempotency-key"];
        if (!key || !fields.get("metadata[amarRefundId]") || key !== `amar-refund-${fields.get("metadata[amarRefundId]")}`) return reply(400, { error: { message: "Missing immutable provider identity" } });
        if (keys.has(key)) return reply(200, keys.get(key));
        const order = await db.order.findUniqueOrThrow({ where: { id: fields.get("metadata[orderId]") } }), amount = Number(fields.get("amount"));
        const returned = [...refunds.values()].filter((row) => row.payment_intent === order.paymentIntentId && row.status === "succeeded").reduce((sum, row) => sum + row.amount, 0);
        if (fields.get("payment_intent") !== order.paymentIntentId || !Number.isSafeInteger(amount) || amount <= 0 || amount + returned > Math.round(Number(order.total) * 100)) return reply(400, { error: { message: "Invalid captured amount" } });
        const row = { id: `re_${randomUUID().replaceAll("-", "")}`, object: "refund", status: "succeeded", amount, currency: "bdt", payment_intent: order.paymentIntentId, created: Math.floor(Date.now() / 1000), metadata: { orderId: order.id, amarRefundId: fields.get("metadata[amarRefundId]") } };
        refunds.set(row.id, row); keys.set(key, row); creates++; return reply(200, row);
      }
      return reply(404, { error: { message: "Unsupported isolated Stripe request" } });
    } catch { diagnostics.errors++; return reply(500, { error: { message: "Isolated provider verification failed" } }); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/`, refunds, diagnostics, get creates() { return creates; }, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
