import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "new isolated 31-migration fixture";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [admin, seller, other, buyer] = await Promise.all(["ADMIN", "MEMBER", "MEMBER", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@settlement-smoke.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED", password: hash } })));
    const category = await db.category.create({ data: { name: "Settlement smoke category", slug: randomUUID() } }), products = await Promise.all([seller, other].map((owner, index) => db.product.create({ data: { name: `Purchased settlement gadget ${index}`, slug: randomUUID(), price: 100 + index * 100, stock: 100, sellerId: owner.id, categoryId: category.id, status: "APPROVED" } })));
    // A real SQL fixture predates configuration. No commercial default may
    // credit it merely because the operator configures a later global rule.
    const old = await db.order.create({ data: { userId: buyer.id, total: 100, status: "DELIVERED", paymentMethod: "COD", paymentStatus: "PAID", subtotalCents: BigInt(10000), discountCents: BigInt(0), shippingCents: BigInt(0), pricingEvidence: "Reviewed historic fixture purchase", pricingReconciledAt: new Date(), items: { create: [{ productId: products[0].id, quantity: 1, price: 100, netCents: BigInt(10000) }] } }, include: { fulfillments: true } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (actor) => { const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    phase = "real role logins, private scope and current viewer header";
    const moderator = await login(admin), vendor = await login(seller), second = await login(other), customer = await login(buyer), path = "/api/settlements", owner = { "X-Settlement-Owner": admin.id }, own = { "X-Settlement-Owner": seller.id };
    const read = async (query = "", cookie = moderator, header = owner) => { const response = await send(path + query, "GET", undefined, cookie, header); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.ok(response.headers.get("x-robots-tag")?.includes("noindex")); return response.json(); };
    assert.equal((await send(path)).status, 403); assert.equal((await send(path, "GET", undefined, customer, { "X-Settlement-Owner": buyer.id })).status, 403); assert.equal((await send(path, "GET", undefined, vendor, owner)).status, 409); assert.equal((await send(`${path}?sellerId=${seller.id}`, "GET", undefined, second, { "X-Settlement-Owner": other.id })).status, 403);
    assert.equal((await read()).effectivePolicy, null); assert.equal((await read("", vendor, own)).summary.payableCents, "0");
    const intent = (fields) => ({ requestId: randomUUID(), reason: "Reviewed actual commercial policy or external payout evidence", confirmed: true, ...fields });
    const post = (body) => send(path, "POST", body, moderator, owner);
    const mutate = async (body) => { const response = await post(body); assert.equal(response.status, 200, `Settlement ${body.action} returned ${response.status}`); return response.json(); };
    phase = "dynamic explicit global/override terms and durable policy receipt";
    const global = intent({ action: "save-policy", scope: "GLOBAL", sellerId: null, version: 0, terms: { commissionBps: 2000, shippingRecipient: "PLATFORM" } }), configured = await mutate(global); assert.deepEqual((await mutate(global)).result, configured.result);
    const override = await mutate(intent({ action: "save-policy", scope: "SELLER", sellerId: seller.id, version: 0, terms: { commissionBps: 1000, shippingRecipient: "SELLER" } }));
    assert.equal((await read("", vendor, own)).summary.payableCents, "0"); assert.equal((await send(path, "POST", global, vendor, own)).status, 403);
    phase = "compiled multi-vendor COD checkout captures actual configured policy";
    let cart = await (await send("/api/cart", "GET", undefined, customer, { "X-Cart-Owner": buyer.id })).json();
    for (const product of products) { const response = await send("/api/cart", "POST", { action: "set", productId: product.id, lineId: null, quantity: 1, version: cart.version, requestId: randomUUID() }, customer, { "X-Cart-Owner": buyer.id }); assert.equal(response.status, 200); cart = await response.json(); }
    cart = await (await send("/api/cart", "GET", undefined, customer, { "X-Cart-Owner": buyer.id })).json();
    const context = { ownerId: buyer.id, sourceId: null, version: cart.version, couponCode: cart.couponCode, couponVersion: cart.couponVersion, previousReceiptId: null, lines: cart.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: 1 })) };
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8")), action = Object.entries(manifest.node).find(([, value]) => value.exportedName === "createOrder" && value.workers?.["app/(marketing)/checkout/page"]); assert.ok(action);
    const checkout = await requestHttp(child.origin + "/checkout", { method: "POST", headers: { Cookie: customer, Origin: child.origin, "Next-Action": action[0], "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", "/checkout") }, body: JSON.stringify([{ cart: context, items: products.map((product) => ({ productId: product.id, quantity: 1 })), fullName: "Settlement test recipient", phone: "01700000000", street: "Settlement fixture road", city: "Dhaka", district: "Dhaka", paymentMethod: "COD", checkoutToken: randomBytes(32).toString("hex") }]) }); assert.equal(checkout.status, 200);
    let purchase; for (const line of (await checkout.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const result = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof result.success === "boolean") purchase = result; } catch { /* Other Flight records. */ } } assert.equal(purchase?.success, true);
    const order = await db.order.findUniqueOrThrow({ where: { id: purchase.orderId }, include: { items: true, fulfillments: true } }); assert.equal(order.shippingCents, BigInt(15000)); assert.equal(order.total.toString(), "450");
    for (const shipment of order.fulfillments) assert.equal((await db.sellerSettlementSnapshot.findUniqueOrThrow({ where: { fulfillmentId: shipment.id } })).policyId, shipment.sellerId === seller.id ? override.result.id : configured.result.id);
    const shipAndDeliver = async (actor, cookie) => {
      const response = await send(`/api/member/fulfillments?orderId=${order.id}`, "GET", undefined, cookie, { "X-Fulfillment-Owner": actor.id }); assert.equal(response.status, 200); const saved = (await response.json()).shipments[0];
      const shipped = await send("/api/member/fulfillments", "POST", { action: "ship", fulfillmentId: saved.id, version: saved.version, carrier: "Actual test courier", trackingNumber: `TRACK-${randomUUID()}` }, cookie, { "X-Fulfillment-Owner": actor.id }); assert.equal(shipped.status, 200); const next = (await shipped.json()).shipment;
      const delivered = await send("/api/admin/fulfillments", "POST", { action: "deliver", fulfillmentId: next.id, version: next.version, codMoneyReceived: true }, moderator, { "X-Fulfillment-Owner": admin.id }); assert.equal(delivered.status, 200);
    };
    phase = "immediate individual COD availability while another seller is unpaid";
    await shipAndDeliver(seller, vendor); assert.equal((await read("", vendor, own)).summary.payableCents, "14000"); assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus, "UNPAID");
    await shipAndDeliver(other, second); assert.equal((await read("", second, { "X-Settlement-Owner": other.id })).summary.payableCents, "16000");
    phase = "competing payout reservations, exact retry and recorded external reference";
    const a = intent({ action: "start-payout", sellerId: seller.id, amountCents: "10000", method: "BANK" }), b = { ...a, requestId: randomUUID() }, responses = await Promise.all([post(a), post(b)]); assert.deepEqual(responses.map((row) => row.status).sort(), [200, 409]);
    const winner = responses[0].status === 200 ? a : b, winningResponse = responses.find((row) => row.status === 200), reserved = await winningResponse.json(); assert.deepEqual((await mutate(winner)).result, reserved.result); assert.equal((await read("", vendor, own)).summary.payableCents, "4000");
    await mutate(intent({ action: "confirm-payout", payoutId: reserved.result.id, version: 1, reference: "ACTUAL-EXTERNAL-REF" }));
    const cancellable = await mutate(intent({ action: "start-payout", sellerId: seller.id, amountCents: "4000", method: "BANK" })), cancel = intent({ action: "cancel-payout", payoutId: cancellable.result.id, version: 1, noMoneySent: true }); await mutate(cancel); await mutate(cancel); assert.equal((await read("", vendor, own)).summary.payableCents, "4000");
    const duplicate = await mutate(intent({ action: "start-payout", sellerId: seller.id, amountCents: "1000", method: "bank" })); assert.equal((await post(intent({ action: "confirm-payout", payoutId: duplicate.result.id, version: 1, reference: "actual-external-ref" }))).status, 409); await mutate(intent({ action: "cancel-payout", payoutId: duplicate.result.id, version: 1, noMoneySent: true }));
    phase = "server-resolved uncertain UUID cannot execute late";
    const uncertain = intent({ action: "start-payout", sellerId: seller.id, amountCents: "1000", method: "BANK" }), stopped = await mutate({ action: "abandon-request", originalIntent: uncertain, confirmed: true }); assert.equal(stopped.result.status, "ABANDONED"); assert.deepEqual((await mutate(uncertain)).result, stopped.result);
    phase = "actual COD refund reverses old captured commission and exposes post-payout debt";
    const changed = await mutate(intent({ action: "save-policy", scope: "SELLER", sellerId: seller.id, version: 1, terms: { commissionBps: 2500, shippingRecipient: "PLATFORM" } }));
    const oldView = await read("?mode=shipments", vendor, own); assert.equal(oldView.rows.find((row) => row.orderId === order.id).capturedCommissionBps, 1000);
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id } }), line = order.items.find((item) => item.productId === products[0].id);
    const requested = await send("/api/admin/refunds", "POST", { action: "request", request: { orderId: order.id, version: current.refundVersion, requestId: randomUUID(), reason: "Actual customer COD refund request", selection: [{ itemId: line.id, quantity: 1 }] } }, moderator, { "X-Refund-Owner": admin.id }); assert.equal(requested.status, 201); const refund = (await requested.json()).refund;
    assert.equal((await read("", vendor, own)).summary.receivableCents, "10000");
    const confirmed = await send("/api/admin/refunds", "POST", { action: "confirm-cod", refundId: refund.id, version: refund.version, moneyReturned: true, method: "BANK", reference: randomUUID() }, moderator, { "X-Refund-Owner": admin.id }); assert.equal(confirmed.status, 200); assert.equal((await read("", vendor, own)).summary.receivableCents, "5000");
    phase = "explicit adoption releases only reviewed historic terms and offsets debt";
    await mutate(intent({ action: "adopt-policy", fulfillmentId: old.fulfillments[0].id, version: 1, policyId: changed.result.id })); assert.equal((await read("", vendor, own)).summary.payableCents, "2500");
    const payouts = await read("?mode=payouts", vendor, own); assert.equal(payouts.rows.filter((row) => row.status === "PAID").length, 1); assert.equal(payouts.rows.find((row) => row.status === "PAID").reference, "ACTUAL-EXTERNAL-REF"); const overview = await read("", vendor, own); assert.equal(overview.monthly.length, 12);
    phase = "real role pages, retained financial evidence and copied-session revocation";
    for (const [route, cookie, title] of [["/admin/settlements", moderator, "Seller settlement and payouts"], ["/member/earnings", vendor, "Seller earnings and holds"], ["/member/payouts", vendor, "Seller payout history"], ["/member/analytics", vendor, "Seller settlement analytics"]]) { const response = await send(route, "GET", undefined, cookie); assert.equal(response.status, 200); assert.ok((await response.text()).includes(title)); }
    await assert.rejects(db.sellerLedgerEntry.deleteMany({ where: { sellerId: seller.id } })); await db.user.update({ where: { id: seller.id }, data: { sessionVersion: { increment: 1 } } }); assert.equal((await send(path, "GET", undefined, vendor, own)).status, 403);
    return { fresh31MigrationDatabase: "PASS", explicitDynamicPolicyAndPrivateScopes: "PASS", compiledMultiVendorCodCapture: "PASS", individualDeliveryCollectionAvailability: "PASS", concurrentReservationAndExactReceipt: "PASS", externalReferenceAndUnsentCancellation: "PASS", delayedRequestServerAbandonment: "PASS", refundOldTermsAndNegativeDebt: "PASS", explicitHistoricAdoptionAndOffset: "PASS", realRolePagesAndRevocation: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Settlement smoke failed during ${phase}${detail}; private provider/database output was not published.`); process.exitCode = 1; });
