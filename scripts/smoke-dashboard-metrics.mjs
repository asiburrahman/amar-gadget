import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "new isolated database";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [buyer, seller, other, admin] = await Promise.all(["USER", "MEMBER", "MEMBER", "ADMIN"].map((role) => db.user.create({ data: { email: `${randomUUID()}@metrics-smoke.example.invalid`, password: hash, isVerified: true, role, sellerStatus: "APPROVED" } })));
    const category = await db.category.create({ data: { name: "Dashboard smoke", slug: randomUUID() } });
    const products = await Promise.all([seller, seller, other].map((owner) => db.product.create({ data: { name: randomUUID(), slug: randomUUID(), price: 100, stock: 100, status: "APPROVED", categoryId: category.id, sellerId: owner.id } })));
    const create = (method, lines, date = "2026-06-01T00:00:00Z") => db.order.create({ data: { userId: buyer.id, status: method === "COD" ? "PROCESSING" : "PENDING", paymentMethod: method, paymentStatus: "UNPAID", total: lines.length * 90 + 10, subtotalCents: BigInt(lines.length * 10000), discountCents: BigInt(lines.length * 1000), shippingCents: BigInt(1000), pricingEvidence: "Original immutable smoke purchase with discount", pricingReconciledAt: new Date(), createdAt: new Date(date), items: { create: lines.map((index) => ({ productId: products[index].id, quantity: 1, price: 100, netCents: BigInt(9000) })) } }, include: { items: true, fulfillments: true } });
    for (let i = 0; i < 12; i++) await create("STRIPE", [0], i === 0 ? "2026-01-31T18:00:00Z" : "2026-06-01T00:00:00Z");
    await create("STRIPE", [0], "2025-12-01T00:00:00Z");
    const mixed = await create("COD", [0, 1, 2], "2026-01-31T17:59:59Z"), refunded = await create("COD", [0]);
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (user) => { const response = await send("/api/auth/login", "POST", { email: user.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    phase = "real sequential account logins";
    // Respect the application's bounded expensive-password-work capacity,
    // including while a build or full test run occupies the machine.
    const cookies = []; for (const actor of [buyer, seller, other, admin]) cookies.push(await login(actor));
    const [customer, vendor, secondVendor, moderator] = cookies;
    const deliver = async (order) => {
      const group = order.fulfillments.find((row) => row.sellerId === seller.id);
      const shipped = await send("/api/member/fulfillments", "POST", { action: "ship", fulfillmentId: group.id, version: group.version, carrier: "Native courier", trackingNumber: `ACTUAL-${group.id}` }, vendor, { "X-Fulfillment-Owner": seller.id }); assert.equal(shipped.status, 200);
      const saved = (await shipped.json()).shipment;
      const delivered = await send("/api/admin/fulfillments", "POST", { action: "deliver", fulfillmentId: group.id, version: saved.version, codMoneyReceived: true }, moderator, { "X-Fulfillment-Owner": admin.id }); assert.equal(delivered.status, 200);
    };
    phase = "compiled per-package COD collection and recorded partial refund";
    await deliver(mixed); await deliver(refunded);
    const refundRead = await send(`/api/admin/refunds?orderId=${refunded.id}`, "GET", undefined, moderator, { "X-Refund-Owner": admin.id }); assert.equal(refundRead.status, 200); const financial = await refundRead.json();
    const request = await send("/api/admin/refunds", "POST", { action: "request", request: { orderId: refunded.id, version: financial.order.version, requestId: randomUUID(), reason: "Verified native customer reimbursement", selection: "FULL" } }, moderator, { "X-Refund-Owner": admin.id }); assert.equal(request.status, 201); const pending = (await request.json()).refund;
    const repayment = await send("/api/admin/refunds", "POST", { action: "confirm-cod", refundId: pending.id, version: pending.version, moneyReturned: true, method: "BANK", reference: `ACTUAL-${randomUUID()}` }, moderator, { "X-Refund-Owner": admin.id }); assert.equal(repayment.status, 200);
    // Parse the real compiled React Server Component payload, not an endpoint
    // invented for this test. UI DOM tests separately exercise visible cards.
    const find = (value, predicate) => { if (!value || typeof value !== "object") return null; if (predicate(value)) return value; for (const child of Object.values(value)) { const result = find(child, predicate); if (result) return result; } return null; };
    const page = async (target, cookie, predicate) => {
      let response = await send(target, "GET", undefined, cookie, { RSC: "1" });
      if (response.status === 307) {
        const location = new URL(response.headers.get("location"), child.origin), original = new URL(target, child.origin);
        if (location.origin === child.origin && location.pathname === original.pathname && location.searchParams.has("_rsc")) response = await send(location.pathname + location.search, "GET", undefined, cookie, { RSC: "1" });
        else console.error(JSON.stringify({ redirectPath: location.pathname, queryFields: [...location.searchParams.keys()] }));
      }
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const line of text.split("\n")) { if (!/^[a-f0-9]+:/.test(line)) continue; try { const result = find(JSON.parse(line.slice(line.indexOf(":") + 1)), predicate); if (result) return result; } catch { /* Module/text rows are not JSON data. */ } }
      throw new Error("Compiled dashboard snapshot was not found");
    };
    phase = "compiled all-time customer snapshot beyond the recent ten";
    const customerData = (await page("/user/dashboard", customer, (value) => value.snapshot?.ownerId === buyer.id)).snapshot;
    assert.equal(customerData.metrics.totalOrders, 15); assert.equal(customerData.recent.length, 10); assert.equal(customerData.metrics.activeOrders, 14); assert.equal(customerData.metrics.netPaidCents, 1000); assert.equal(customerData.metrics.deliveredPaidCents, 1000); assert.equal(customerData.metrics.partiallyCollectedCodOrders, 1);
    assert.ok(customerData.recent.every((row) => !Object.hasOwn(row, "shippingAddress"))); assert.ok(!JSON.stringify(customerData).includes(other.email));
    phase = "compiled distinct seller cohorts, Dhaka boundary and immutable seller ownership";
    await db.product.update({ where: { id: products[0].id }, data: { sellerId: other.id, price: 9999 } });
    const sellerData = (await page("/member/dashboard?year=2026", vendor, (value) => value.metrics?.ownerId === seller.id)).metrics;
    assert.equal(sellerData.totalOrders, 15); assert.equal(sellerData.pendingOrders, 13); assert.equal(sellerData.paidItemCents, 18000); assert.equal(sellerData.deliveredItemCents, 18000); assert.equal(sellerData.deliveredUnits, 2);
    assert.deepEqual(sellerData.monthly.map((row) => [row.month, row.ordersCount, row.paidItemCents]), [["2026-06", 12, 0], ["2026-02", 1, 0], ["2026-01", 1, 18000]]);
    const earlier = (await page("/member/dashboard?year=2025", vendor, (value) => value.metrics?.ownerId === seller.id)).metrics; assert.equal(earlier.monthly[0].ordersCount, 1);
    const foreignData = (await page("/member/dashboard?year=2026", secondVendor, (value) => value.metrics?.ownerId === other.id)).metrics; assert.equal(foreignData.totalOrders, 1); assert.equal(foreignData.paidItemCents, 0);
    phase = "actual duplicated year rejection";
    const invalid = await send("/member/dashboard?year=2026&year=2025", "GET", undefined, vendor); assert.ok((await invalid.text()).includes("Invalid analytics year"));
    phase = "actual blocked seller response";
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } });
    // Account-status changes revoke the copied token through the existing SQL
    // session-version guard. A fresh password login can view account status.
    const staleSeller = await send("/member/dashboard", "GET", undefined, vendor); assert.ok(staleSeller.status >= 300 || (await staleSeller.text()).includes("/login"));
    const blockedCookie = await login(seller), blocked = await send("/member/dashboard", "GET", undefined, blockedCookie); assert.ok((await blocked.text()).includes("Seller account status"));
    phase = "actual revoked customer response";
    await db.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } }); const revoked = await send("/user/dashboard", "GET", undefined, customer); assert.ok(revoked.status >= 300 || (await revoked.text()).includes("/login"));
    return { compiledAllTimeCustomerMetricsAndBoundedRecentOrders: "PASS", actualCodRefundAndShipping: "PASS", distinctSellerCohortsAndDhakaBoundary: "PASS", capturedOwnershipAndCurrentPriceIsolation: "PASS", actualYearValidationRoleAndRevocation: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`Dashboard metrics smoke failed during ${phase}: ${error?.code === "ERR_ASSERTION" ? error.message : "private diagnostic withheld"}. Private child output and credentials were not published.`); process.exitCode = 1; });
