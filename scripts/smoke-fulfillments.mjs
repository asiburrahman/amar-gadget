import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Stripe from "stripe";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "fixture setup";
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search || url.hash) throw new Error("Use an isolated local audit_* database.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }) });
  const prefix = `audit-fulfillment-smoke-${randomUUID()}`, secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex");
  let buyer, seller, secondSeller, admin, category, child, redis;
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    [buyer, seller, secondSeller, admin] = await Promise.all(["buyer", "seller", "second-seller", "admin"].map((name) => db.user.create({ data: { email: `${prefix}-${name}@example.invalid`, name: name, password: hash, isVerified: true, role: name === "admin" ? "ADMIN" : name === "buyer" ? "USER" : "MEMBER", sellerStatus: "APPROVED" } })));
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    const products = await Promise.all([seller, secondSeller].map((owner, i) => db.product.create({ data: { name: `${prefix}-product-${i}`, slug: `${prefix}-product-${i}`, price: 100 + i * 100, stock: 10, sellerId: owner.id, categoryId: category.id, status: "APPROVED" } })));
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, owner, header = "X-Fulfillment-Owner") => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(owner ? { [header]: owner } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (user) => { const response = await send("/api/auth/login", "POST", { email: user.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const [customer, vendor, secondVendor, moderator] = await Promise.all([buyer, seller, secondSeller, admin].map(login));
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const action = (name, worker) => { const entry = Object.entries(manifest.node).find(([, value]) => value.exportedName === name && value.workers?.[worker]); assert.ok(entry); return entry[0]; };
    const call = async (target, reference, args, cookie) => {
      const response = await requestHttp(child.origin + target, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Next-Action": reference, "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", target) }, body: JSON.stringify(args) }); assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const value = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof value.success === "boolean") return value; } catch { /* Other Flight rows. */ } }
      throw new Error("Compiled action returned no result.");
    };
    const purchase = async (paymentMethod) => {
      let cart = await (await send("/api/cart", "GET", undefined, customer, buyer.id, "X-Cart-Owner")).json();
      for (const product of products) { const saved = await send("/api/cart", "POST", { action: "set", productId: product.id, lineId: null, quantity: 1, version: cart.version, requestId: randomUUID() }, customer, buyer.id, "X-Cart-Owner"); assert.equal(saved.status, 200); cart = await saved.json(); }
      const savedCart = await send("/api/cart", "GET", undefined, customer, buyer.id, "X-Cart-Owner"); assert.equal(savedCart.status, 200); cart = await savedCart.json();
      const context = { ownerId: buyer.id, sourceId: null, version: cart.version, couponCode: null, couponVersion: cart.couponVersion, previousReceiptId: null, lines: cart.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: line.quantity })) };
      const result = await call("/checkout", action("createOrder", "app/(marketing)/checkout/page"), [{ cart: context, items: products.map((product) => ({ productId: product.id, quantity: 1 })), fullName: "Native recipient", phone: "01700000000", street: "Fulfillment fixture road", city: "Dhaka", district: "Dhaka", paymentMethod, checkoutToken: randomBytes(32).toString("hex") }], customer); assert.equal(result.success, true); return result;
    };
    const mine = async (orderId, cookie = vendor, owner = seller.id) => { const response = await send(`/api/member/fulfillments?orderId=${orderId}`, "GET", undefined, cookie, owner); assert.equal(response.status, 200); return (await response.json()).shipments[0]; };
    const change = (group, body, cookie = vendor, owner = seller.id, path = "/api/member/fulfillments") => send(path, "POST", { fulfillmentId: group.id, version: group.version, ...body }, cookie, owner);
    const ship = async (group, cookie = vendor, owner = seller.id) => { const response = await change(group, { action: "ship", carrier: "Native courier", trackingNumber: `REAL-${group.id}` }, cookie, owner); assert.equal(response.status, 200); return (await response.json()).shipment; };
    const deliver = async (group) => { const response = await change(group, { action: "deliver", codMoneyReceived: group.paymentMethod === "COD" }, moderator, admin.id, "/api/admin/fulfillments"); assert.equal(response.status, 200); return (await response.json()).shipment; };
    phase = "compiled mixed-vendor cart and COD order";
    const cod = await purchase("COD"); let first = await mine(cod.orderId), second = await mine(cod.orderId, secondVendor, secondSeller.id);
    assert.equal(first.items[0].productId, products[0].id); assert.equal(second.items[0].productId, products[1].id); assert.equal(first.items.length, 1);
    const privateText = JSON.stringify(first); for (const hidden of [buyer.id, buyer.email, secondSeller.id, products[1].id]) assert.ok(!privateText.includes(hidden)); assert.ok(!Object.hasOwn(first, "total"));
    assert.equal((await change(first, { action: "ship", carrier: "Courier", trackingNumber: "FOREIGN" }, secondVendor, secondSeller.id)).status, 404);
    first = await ship(first); assert.equal(first.orderStatus, "PARTIALLY_SHIPPED"); second = await ship(second, secondVendor, secondSeller.id);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: cod.orderId } })).status, "SHIPPED");
    phase = "per-shipment administrator COD confirmation and partial eligibility";
    assert.equal((await change(first, { action: "deliver", codMoneyReceived: true })).status, 403);
    assert.equal((await change(first, { action: "deliver", codMoneyReceived: false }, moderator, admin.id, "/api/admin/fulfillments")).status, 400);
    first = await deliver(first); assert.equal(first.paymentStatus, "PAID"); assert.equal((await db.order.findUniqueOrThrow({ where: { id: cod.orderId } })).paymentStatus, "UNPAID");
    for (const [i, expected] of [[0, true], [1, false]]) { const response = await send(`/api/user/reviews?productId=${products[i].id}`, "GET", undefined, customer, buyer.id, "X-Review-Owner"); assert.equal(response.status, 200); assert.equal((await response.json()).eligible, expected); }
    const tracking = await send(`/api/orders/${cod.orderId}?phone=01700000000`); assert.equal(tracking.status, 200); const publicOrder = (await tracking.json()).order; assert.equal(publicOrder.status, "PARTIALLY_DELIVERED"); assert.equal(publicOrder.shipments.length, 2); assert.ok(!JSON.stringify(publicOrder).includes(buyer.email));
    second = await deliver(second); assert.equal(second.orderStatus, "DELIVERED"); assert.equal((await db.order.findUniqueOrThrow({ where: { id: cod.orderId } })).paymentStatus, "PAID");
    phase = "real signed Stripe webhook and independent card shipments";
    const card = await purchase("STRIPE"), pending = await mine(card.orderId); assert.equal((await change(pending, { action: "ship", carrier: "Courier", trackingNumber: "UNPAID" })).status, 409);
    const stored = await db.order.findUniqueOrThrow({ where: { id: card.orderId } }), stripe = new Stripe("sk_test_isolated_smoke_only");
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type: "checkout.session.completed", data: { object: { id: `cs_${card.orderId}`, metadata: { orderId: card.orderId }, payment_status: "paid", status: "complete", amount_total: Math.round(Number(stored.total) * 100), currency: "bdt", payment_intent: "pi_isolated_fulfillment_smoke" } } });
    const webhookPath = "/api/stripe/webhook", payment = await requestHttp(child.origin + webhookPath, { method: "POST", headers: { ...signature("POST", webhookPath), "Content-Type": "application/json", "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_isolated_smoke_only" }) }, body: payload }); assert.equal(payment.status, 200);
    const shippedCard = await ship(await mine(card.orderId)); const deliveredCard = await deliver(shippedCard); assert.equal(deliveredCard.orderStatus, "PARTIALLY_DELIVERED"); assert.equal(deliveredCard.codCollectedAt, null);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: card.orderId } })).paymentStatus, "PAID");
    phase = "actual role pages and copied-session revocation";
    for (const [target, cookie, title] of [["/member/orders", vendor, "My seller shipments"], ["/admin/orders", moderator, "Platform Orders Management"], ["/user/orders", customer, "Orders"]]) { const response = await send(target, "GET", undefined, cookie); assert.equal(response.status, 200); assert.ok((await response.text()).includes(title)); }
    await db.user.update({ where: { id: seller.id }, data: { sessionVersion: { increment: 1 } } }); assert.equal((await send("/api/member/fulfillments", "GET", undefined, vendor, seller.id)).status, 401);
    return { compiledMixedCheckoutAndSellerIsolation: "PASS", independentShippingAndRealTracking: "PASS", explicitAdminCodAndAllShipmentsPaidAggregation: "PASS", partialReviewEligibilityAndPublicTracking: "PASS", verifiedStripeWebhookAndCardFulfillment: "PASS", actualRolePagesAndSessionRevocation: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try {
      if (buyer) { await db.orderItem.deleteMany({ where: { order: { userId: buyer.id } } }); await db.order.deleteMany({ where: { userId: buyer.id } }); }
      if (category) { await db.product.deleteMany({ where: { categoryId: category.id } }); await db.category.delete({ where: { id: category.id } }); }
      const users = [buyer?.id, seller?.id, secondSeller?.id, admin?.id].filter(Boolean); if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && typeof error.actual === "number" && typeof error.expected === "number" ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Fulfillment smoke failed during ${phase}${detail}. Private child output, credentials and action manifest keys were not published.`); process.exitCode = 1; });
