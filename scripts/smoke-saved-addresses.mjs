import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
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
  const prefix = `audit-address-smoke-${randomUUID()}`, password = randomBytes(32).toString("hex"), secret = randomBytes(32).toString("hex");
  let child, redis, owner, other, seller, category, product;
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, password: hash, role: "USER", isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, password: hash, role: "USER", isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    product = await db.product.create({ data: { name: prefix, slug: prefix, price: 100, discountPrice: 80, stock: 2, status: "APPROVED", sellerId: seller.id, categoryId: category.id } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    phase = "prepared server startup"; child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (email) => { const response = await send("/api/auth/login", "POST", { email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const cookie = await login(owner.email), foreignCookie = await login(other.email), path = "/api/user/addresses";
    phase = "private ingress and session boundaries";
    assert.equal((await requestHttp(child.origin + path)).status, 403);
    assert.equal((await send(path)).status, 401);
    assert.equal((await requestHttp(child.origin + path, { method: "POST", headers: { Cookie: cookie, Origin: "https://foreign.example.invalid", ...signature("POST", path) }, body: "{}" })).status, 403);
    const fields = { fullName: "Native address recipient", phone: "01700000000", street: "Actual fixture road 12", city: "Dhaka", district: "Dhaka", zipCode: "1200" };
    phase = "actual address CRUD and default selection";
    const created = await send(path, "POST", { fields }, cookie); assert.equal(created.status, 201); const first = (await created.json()).address; assert.equal(first.isDefault, true);
    const secondResponse = await send(path, "POST", { fields: { ...fields, fullName: "Office recipient", street: "Office fixture road 21" } }, cookie); assert.equal(secondResponse.status, 201); const second = (await secondResponse.json()).address;
    const revision = (row) => ({ id: row.id, version: row.version });
    assert.equal((await send(path, "PUT", { ...revision(first), fields }, foreignCookie)).status, 404);
    assert.equal((await (await send(path, "GET", undefined, foreignCookie)).json()).total, 0);
    const defaultResponse = await send(path, "PATCH", revision(second), cookie); assert.equal(defaultResponse.status, 200); const selected = (await defaultResponse.json()).address;
    const listed = await send(path, "GET", undefined, cookie); assert.equal(listed.headers.get("cache-control"), "private, no-store"); assert.ok(listed.headers.get("x-robots-tag")?.includes("noindex"));
    assert.equal((await listed.json()).defaultAddress.id, selected.id);
    const ownerPage = await send("/user/addresses", "GET", undefined, cookie); assert.equal(ownerPage.status, 200); assert.ok((await ownerPage.text()).includes("Saved shipping addresses"));
    phase = "compiled checkout with selected shipping values";
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const action = Object.entries(manifest.node).find(([, value]) => value.exportedName === "createOrder" && value.workers?.["app/(marketing)/checkout/page"]); assert.ok(action);
    const checkout = { fullName: selected.fullName, phone: selected.phone, street: selected.street, city: selected.city, district: selected.district, zipCode: selected.zipCode ?? "", items: [{ productId: product.id, quantity: 1 }], paymentMethod: "COD", checkoutToken: randomBytes(32).toString("hex") };
    const placed = await requestHttp(child.origin + "/checkout", { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Next-Action": action[0], "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", "/checkout") }, body: JSON.stringify([checkout]) }); assert.equal(placed.status, 200);
    let result;
    for (const line of (await placed.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const item = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof item.success === "boolean") { result = item; break; } } catch { /* Other Flight rows. */ } }
    assert.equal(result?.success, true);
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } }); assert.ok(order.shippingAddress.includes(selected.street)); assert.equal(Number(order.total), 230); assert.equal(order.paymentStatus, "UNPAID");
    phase = "stale profile default rejection";
    assert.equal((await send("/api/user/profile", "PUT", { address: fields, addressRevision: revision(first) }, cookie)).status, 409);
    phase = "saved address edit after checkout";
    const edited = await send(path, "PUT", { ...revision(selected), fields: { ...fields, street: "Later edited road 99" } }, cookie); assert.equal(edited.status, 200); const current = (await edited.json()).address;
    phase = "stale address revision rejection";
    assert.equal((await send(path, "PUT", { ...revision(selected), fields }, cookie)).status, 409);
    phase = "saved default deletion after checkout";
    assert.equal((await send(path, "DELETE", revision(current), cookie)).status, 200);
    phase = "immutable committed shipping snapshot and default promotion";
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).shippingAddress, order.shippingAddress);
    assert.equal((await (await send(path, "GET", undefined, cookie)).json()).defaultAddress.id, first.id);
    phase = "copied-cookie revocation";
    await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal((await send(path, "GET", undefined, cookie)).status, 401);
    return { realAuthenticatedAddressCrud: "PASS", ownerIsolationAndPrivateHeaders: "PASS", singleDefaultAndStaleRevision: "PASS", actualOwnerPage: "PASS", compiledCheckoutSelectedShipping: "PASS", serverPriceAndImmutableOrderSnapshot: "PASS", profileDefaultConflict: "PASS", ingressOriginAndRevocation: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try {
      if (owner) { await db.orderItem.deleteMany({ where: { order: { userId: owner.id } } }); await db.order.deleteMany({ where: { userId: owner.id } }); }
      const users = [owner?.id, other?.id, seller?.id].filter(Boolean);
      if (users.length) await db.address.deleteMany({ where: { userId: { in: users } } });
      if (product) await db.product.delete({ where: { id: product.id } }); if (category) await db.category.delete({ where: { id: category.id } });
      if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && typeof error.actual === "number" && typeof error.expected === "number" ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Saved addresses smoke failed during ${phase}${detail}. Private child output and action manifest keys were not published.`); process.exitCode = 1; });
