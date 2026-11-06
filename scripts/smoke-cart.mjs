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
  const prefix = `audit-cart-smoke-${randomUUID()}`, secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), webhookSecret = `whsec_${randomBytes(32).toString("hex")}`;
  let owner, other, seller, category, child, redis; const guestUsers = [];
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, password: hash, isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, password: hash, isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    const first = await db.product.create({ data: { name: `${prefix} first`, slug: `${prefix}-first`, price: 100, discountPrice: 80, stock: 10, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    const second = await db.product.create({ data: { name: `${prefix} second`, slug: `${prefix}-second`, price: 200, stock: 10, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    const hidden = await db.product.create({ data: { name: `${prefix} hidden title`, slug: `${prefix}-hidden`, price: 1, stock: 10, sellerId: seller.id, categoryId: category.id, status: "PENDING_APPROVAL" } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); phase = "prepared artifact startup";
    child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret, STRIPE_WEBHOOK_SECRET: webhookSecret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, expectedOwner) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(expectedOwner ? { "X-Cart-Owner": expectedOwner } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (email) => { const response = await send("/api/auth/login", "POST", { email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const a = await login(owner.email), b = await login(owner.email), foreign = await login(other.email), path = "/api/cart";
    const read = async (cookie = a, id = owner.id) => { const response = await send(path, "GET", undefined, cookie, id); assert.equal(response.status, 200); return response.json(); };
    const mutate = (input, cookie = a, id = owner.id) => send(path, "POST", { ...input, requestId: input.requestId ?? randomUUID() }, cookie, id);
    phase = "ingress Origin and expected-owner boundaries";
    assert.equal((await requestHttp(child.origin + path)).status, 403); assert.equal((await send(path)).status, 401);
    assert.equal((await requestHttp(child.origin + path, { method: "POST", headers: { Cookie: a, Origin: "https://foreign.example.invalid", "X-Cart-Owner": owner.id, ...signature("POST", path) }, body: "{}" })).status, 403);
    assert.equal((await send(path, "GET", undefined, foreign, owner.id)).status, 409);
    phase = "real two-session persistence and most-recent request retry";
    const initial = await read(); const edit = { action: "set", productId: first.id, lineId: null, quantity: 3, version: initial.version, requestId: randomUUID() };
    assert.equal((await mutate(edit)).status, 200); assert.equal((await mutate(edit, b)).status, 200);
    const saved = await read(b); assert.equal(saved.lines[0].quantity, 3); assert.equal(saved.version, 1); assert.equal(saved.lines[0].product.discountPrice, 80);
    assert.equal((await mutate({ ...edit, quantity: 4 })).status, 409);
    await db.product.update({ where: { id: first.id }, data: { price: 120, discountPrice: 100, stock: 7 } }); const current = await read(b); assert.equal(current.lines[0].product.price, 120); assert.equal(current.lines[0].product.stock, 7);
    const merge = await mutate({ action: "merge", version: current.version, items: [{ productId: first.id, quantity: 2 }, { productId: second.id, quantity: 1 }, { productId: hidden.id, quantity: 1 }] }, b);
    assert.equal(merge.status, 200); assert.deepEqual((await merge.json()).skippedIds, [hidden.id]); assert.equal((await read()).lines[0].quantity, 3);
    const publicRows = await send("/api/cart/guest", "POST", { lines: [{ productId: hidden.id, lineId: randomUUID(), quantity: 1 }] }); assert.equal(publicRows.status, 200); const publicData = await publicRows.json(); assert.equal(publicData.lines[0].product, null); assert.ok(!JSON.stringify(publicData).includes(hidden.name));
    phase = "compiled authoritative COD checkout and immutable cart lineage";
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const action = Object.entries(manifest.node).find(([, value]) => value.exportedName === "createOrder" && value.workers?.["app/(marketing)/checkout/page"]); assert.ok(action);
    const place = async (input, cookie) => {
      const response = await requestHttp(child.origin + "/checkout", { method: "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: child.origin, "Next-Action": action[0], "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", "/checkout") }, body: JSON.stringify([input]) }); assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const item = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof item.success === "boolean") return item; } catch { /* Other Flight rows. */ } }
      throw new Error("Compiled checkout did not return a result.");
    };
    const context = (snapshot) => ({ ownerId: owner.id, sourceId: null, version: snapshot.version, couponCode: snapshot.couponCode, couponVersion: snapshot.couponVersion, previousReceiptId: null, lines: snapshot.lines.filter((line) => line.id === first.id).map((line) => ({ productId: line.id, lineId: line.lineId, quantity: 1 })) });
    const input = (cart, paymentMethod = "COD") => ({ fullName: "Cart smoke recipient", phone: "01700000000", street: "Cart fixture road 12", city: "Dhaka", district: "Dhaka", items: cart.lines.map(({ productId, quantity }) => ({ productId, quantity })), cart, paymentMethod, checkoutToken: randomBytes(32).toString("hex") });
    const codInput = input(context(await read())), cod = await place(codInput, a); assert.equal(cod.success, true); assert.equal((await place(codInput, b)).orderId, cod.orderId);
    const order = await db.order.findUniqueOrThrow({ where: { id: cod.orderId } }); assert.equal(Number(order.total), 250); assert.ok(order.cartConsumedAt); assert.equal(order.paymentStatus, "UNPAID");
    const afterCod = await read(b); assert.equal(afterCod.lines.find((line) => line.id === first.id).quantity, 2); assert.equal(afterCod.lines.find((line) => line.id === second.id).quantity, 1); assert.equal(afterCod.recentCheckout.id, cod.orderId);
    phase = "real signed Stripe HTTP event and idempotent cart consumption";
    const stripeInput = input(context(afterCod), "STRIPE"), pending = await place(stripeInput, a); assert.equal(pending.success, true); assert.deepEqual(Object.keys((await read(b)).pendingCheckouts), [pending.orderId]);
    const more = await read(); assert.equal((await mutate({ action: "set", productId: first.id, lineId: more.lines.find((line) => line.id === first.id).lineId, quantity: 4, version: more.version })).status, 200);
    const reserved = await db.order.findUniqueOrThrow({ where: { id: pending.orderId } });
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type: "checkout.session.completed", data: { object: { id: `cs_${randomUUID()}`, metadata: { orderId: pending.orderId }, status: "complete", payment_status: "paid", amount_total: Math.round(Number(reserved.total) * 100), currency: "bdt", payment_intent: `pi_${randomUUID()}` } } });
    const stripeSignature = new Stripe("sk_test_local_signature_only").webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    for (let index = 0; index < 2; index++) assert.equal((await requestHttp(child.origin + "/api/stripe/webhook", { method: "POST", headers: { ...signature("POST", "/api/stripe/webhook"), "stripe-signature": stripeSignature, "Content-Type": "application/json" }, body: payload })).status, 200);
    assert.equal((await read(b)).lines.find((line) => line.id === first.id).quantity, 3); assert.deepEqual(Object.keys((await read()).pendingCheckouts), []);
    phase = "guest source deduplication, secret recovery and authorized acknowledgement";
    const guestCart = { ownerId: null, sourceId: randomUUID(), version: 1, couponCode: null, couponVersion: 0, previousReceiptId: null, lines: [{ productId: first.id, lineId: randomUUID(), quantity: 1 }] }, guestInput = input(guestCart), guestOrder = await place(guestInput);
    assert.equal(guestOrder.success, true); guestUsers.push((await db.order.findUniqueOrThrow({ where: { id: guestOrder.orderId } })).userId);
    assert.equal((await place(input(guestCart))).code, "CART_GUEST_REVIEW");
    const recovered = await send("/api/checkout/attempt", "POST", { checkoutToken: guestInput.checkoutToken, ownerId: null, sourceId: guestCart.sourceId }); assert.equal(recovered.status, 200); const recoveredData = await recovered.json(); assert.equal(recoveredData.order.id, guestOrder.orderId); assert.ok(!JSON.stringify(recoveredData).includes(guestInput.phone));
    const resumeCookie = recovered.headers.getSetCookie().map((value) => value.split(";")[0]).find((value) => value.startsWith("checkout_resume_token=")); assert.ok(resumeCookie);
    assert.equal((await send(`/api/checkout/${guestOrder.orderId}`, "POST", { action: "ack-cart" }, `${foreign}; ${resumeCookie}`)).status, 404);
    assert.equal((await send(`/api/checkout/${guestOrder.orderId}`, "POST", { action: "ack-cart" }, resumeCookie)).status, 200);
    assert.ok((await db.order.findUniqueOrThrow({ where: { id: guestOrder.orderId } })).cartAcknowledgedAt);
    phase = "private pages, headers and copied-session revocation";
    const privateResponse = await send(path, "GET", undefined, a, owner.id); assert.equal(privateResponse.headers.get("cache-control"), "private, no-store"); assert.ok(privateResponse.headers.get("x-robots-tag")?.includes("noindex"));
    for (const page of ["/cart", "/checkout"]) assert.equal((await send(page, "GET", undefined, a)).status, 200);
    assert.equal((await read(foreign, other.id)).lines.length, 0);
    await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
    for (const cookie of [a, b]) assert.equal((await send(path, "GET", undefined, cookie, owner.id)).status, 401);
    return { twoSessionAccountCart: "PASS", expectedOwnerAndStaleRequest: "PASS", currentPriceStockAndMerge: "PASS", compiledCodLineConsumption: "PASS", signedStripeDuplicateAndExtraQuantity: "PASS", guestSourceDedupAndSecretRecovery: "PASS", guestAcknowledgementAuthorization: "PASS", privatePagesOriginIngressAndRevocation: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try {
      const users = [owner?.id, other?.id, seller?.id, ...guestUsers].filter(Boolean);
      if (users.length) { await db.orderItem.deleteMany({ where: { order: { userId: { in: users } } } }); await db.order.deleteMany({ where: { userId: { in: users } } }); }
      if (seller) await db.product.deleteMany({ where: { sellerId: seller.id } }); if (category) await db.category.delete({ where: { id: category.id } });
      if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && typeof error.actual === "number" && typeof error.expected === "number" ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Cart smoke failed during ${phase}${detail}. Private child output, credentials and action manifest keys were not published.`); process.exitCode = 1; });
