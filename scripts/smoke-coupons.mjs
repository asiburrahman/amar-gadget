import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "isolated coupon fixture";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex");
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [admin, seller, buyer] = await Promise.all(["ADMIN", "MEMBER", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@coupons-smoke.example.invalid`, password: hash, isVerified: true, role, sellerStatus: "APPROVED" } })));
    const category = await db.category.create({ data: { name: "Coupon smoke category", slug: randomUUID() } });
    const product = await db.product.create({ data: { name: "Actual coupon checkout product", slug: randomUUID(), price: 1000, discountPrice: 900.01, stock: 10, status: "APPROVED", sellerId: seller.id, categoryId: category.id } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (account) => { const response = await send("/api/auth/login", "POST", { email: account.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const moderator = await login(admin), customer = await login(buyer), owner = { "X-Coupon-Owner": admin.id }, path = "/api/admin/coupons";
    const mutate = async (body) => { const response = await send(path, "POST", body, moderator, owner); assert.equal(response.status, 200, `Coupon ${body.action} returned ${response.status}`); return response.json(); };
    phase = "compiled coupon creation, original receipt and shared quote preview";
    const fields = { code: "NATIVE-COUPON", discount: 7.35, isPercentage: true, minSpend: 900.01, expiresAt: null, isActive: true }, creation = { action: "create", requestId: randomUUID(), fields };
    const created = await mutate(creation); assert.equal((await mutate(creation)).row.id, created.row.id); assert.equal(await db.coupon.count(), 1);
    const preview = await mutate({ action: "preview", target: { id: created.row.id, version: 1 }, fields, subtotal: 900.01, paymentMethod: "COD" });
    const quoted = await send("/api/checkout/quote", "POST", { items: [{ productId: product.id, quantity: 1 }], couponCode: fields.code, paymentMethod: "COD" }, customer); assert.equal(quoted.status, 200); const { quote } = await quoted.json();
    const { items, fingerprint, ...totals } = quote; assert.equal(items.length, 1); assert.match(fingerprint, /^[a-f0-9]{64}$/); assert.deepEqual(preview.totals, totals); assert.equal(totals.total, 983.86);
    phase = "actual account cart and compiled coupon-priced order";
    const cartHeaders = { "X-Cart-Owner": buyer.id }, readCart = async () => { const response = await send("/api/cart", "GET", undefined, customer, cartHeaders); assert.equal(response.status, 200); return response.json(); };
    let cart = await readCart();
    assert.equal((await send("/api/cart", "POST", { action: "set", requestId: randomUUID(), version: cart.version, productId: product.id, lineId: null, quantity: 1 }, customer, cartHeaders)).status, 200);
    cart = await readCart(); assert.equal((await send("/api/cart", "POST", { action: "coupon", requestId: randomUUID(), version: cart.version, code: fields.code }, customer, cartHeaders)).status, 200); cart = await readCart();
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const action = Object.entries(manifest.node).find(([, value]) => value.exportedName === "createOrder" && value.workers?.["app/(marketing)/checkout/page"]); assert.ok(action);
    const place = async (input) => {
      const response = await requestHttp(child.origin + "/checkout", { method: "POST", headers: { Cookie: customer, Origin: child.origin, "Next-Action": action[0], "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", "/checkout") }, body: JSON.stringify([input]) }); assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const item = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof item.success === "boolean") return item; } catch { /* Other Flight rows. */ } }
      throw new Error("Compiled checkout did not return a result.");
    };
    const input = { fullName: "Coupon smoke recipient", phone: "01700000000", street: "Coupon fixture road 12", city: "Dhaka", district: "Dhaka", items: [{ productId: product.id, quantity: 1 }], couponCode: fields.code, paymentMethod: "COD", checkoutToken: randomBytes(32).toString("hex"), quoteFingerprint: quote.fingerprint,
      cart: { ownerId: buyer.id, sourceId: null, version: cart.version, couponCode: cart.couponCode, couponVersion: cart.couponVersion, previousReceiptId: null, lines: cart.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: line.quantity })) } };
    const result = await place(input); assert.equal(result.success, true); const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } });
    assert.equal(Number(order.total), totals.total); assert.equal(order.discountCents, 6615n); assert.equal(order.subtotalCents, 90001n); assert.ok(order.cartConsumedAt); assert.equal((await readCart()).lines.length, 0);
    phase = "future deactivation, retained purchase and used-code protection";
    await mutate({ action: "activation", requestId: randomUUID(), id: created.row.id, version: 1, isActive: false });
    assert.equal((await send("/api/checkout/quote", "POST", { items: input.items, couponCode: fields.code, paymentMethod: "COD" }, customer)).status, 422);
    assert.equal((await place(input)).orderId, order.id); assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: order.id } }), order);
    assert.equal((await send(path, "POST", { action: "update", requestId: randomUUID(), id: created.row.id, version: 2, fields: { ...fields, code: "RENAMED" } }, moderator, owner)).status, 409);
    const receipt = await send(`${path}?requestId=${creation.requestId}&q=NO-MATCH`, "GET", undefined, moderator, owner); assert.equal(receipt.status, 200); const recovered = await receipt.json(); assert.equal(recovered.rows.length, 0); assert.equal(recovered.attemptedRow.version, 2);
    phase = "compiled private page, audit history, role, origin and session guards";
    const history = await send(`${path}?mode=history&id=${created.row.id}`, "GET", undefined, moderator, owner); assert.equal(history.status, 200); const events = (await history.json()).events; assert.equal(events.length, 2); assert.ok(events.every((event) => event.actorId === admin.id)); assert.equal(history.headers.get("cache-control"), "private, no-store");
    assert.equal((await send("/admin/coupons", "GET", undefined, moderator)).status, 200);
    assert.equal((await send(path, "GET", undefined, customer, { "X-Coupon-Owner": buyer.id })).status, 403);
    assert.equal((await send(path, "GET", undefined, moderator, { "X-Coupon-Owner": buyer.id })).status, 409);
    assert.equal((await send(path, "POST", creation, moderator, { ...owner, Origin: "https://wrong.example.invalid" })).status, 403);
    await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } }); assert.equal((await send(path, "GET", undefined, moderator, owner)).status, 403);
    return { compiledCouponCrudReceiptAndPreview: "PASS", actualDiscountedSkuQuoteAgreement: "PASS", actualCartAndCompiledOrderSnapshots: "PASS", deactivationRetainedOrderAndUsedCodeGuard: "PASS", privatePageAuditOriginOwnerRoleAndRevocation: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.error(`Coupon smoke failed during ${phase}: ${error?.code === "ERR_ASSERTION" ? error.message : "private diagnostic withheld"}. Private child output, manifest keys and credentials were not published.`); process.exitCode = 1; });
