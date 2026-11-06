import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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
  const prefix = `audit-wishlist-smoke-${randomUUID()}`, secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex");
  let owner, other, seller, category, child, redis;
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, password: hash, isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, password: hash, isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    const first = await db.product.create({ data: { name: `${prefix} first`, slug: `${prefix}-first`, price: 100, discountPrice: 80, stock: 2, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    const second = await db.product.create({ data: { name: `${prefix} second`, slug: `${prefix}-second`, price: 200, discountPrice: 150, stock: 0, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    const hidden = await db.product.create({ data: { name: `${prefix} hidden secret title`, slug: `${prefix}-hidden`, price: 300, stock: 1, sellerId: seller.id, categoryId: category.id, status: "PENDING_APPROVAL" } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); phase = "prepared artifact startup"; child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, expectedOwner) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(expectedOwner ? { "X-Wishlist-Owner": expectedOwner } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (email) => { const response = await send("/api/auth/login", "POST", { email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const a = await login(owner.email), b = await login(owner.email), foreign = await login(other.email), path = "/api/wishlist";
    const read = async (cookie = a, id = owner.id) => { const response = await send(path, "GET", undefined, cookie, id); assert.equal(response.status, 200); return response.json(); };
    phase = "ingress Origin and expected-owner boundaries";
    assert.equal((await requestHttp(child.origin + path)).status, 403); assert.equal((await send(path)).status, 401);
    assert.equal((await requestHttp(child.origin + path, { method: "POST", headers: { Cookie: a, Origin: "https://foreign.example.invalid", "X-Wishlist-Owner": owner.id, ...signature("POST", path) }, body: "{}" })).status, 403);
    assert.equal((await send(path, "POST", { productIds: [first.id] }, foreign, owner.id)).status, 409);
    phase = "actual add and cross-session reads";
    assert.equal((await send(path, "POST", { productIds: [first.id] }, a, owner.id)).status, 200);
    const initial = await read(b); assert.equal(initial.total, 1); assert.equal(initial.items[0].product.discountPrice, 80); assert.equal(initial.items[0].product.stock, 2);
    assert.equal((await send(path, "POST", { productIds: [first.id] }, b, owner.id)).status, 200); assert.equal((await read(a)).version, initial.version);
    assert.equal((await send(path, "POST", { productIds: [first.id], price: 1 }, a, owner.id)).status, 400);
    await db.product.update({ where: { id: first.id }, data: { price: 120 } }); assert.equal((await read(b)).items[0].product.price, 120);
    phase = "additive merge and unavailable product suppression";
    const merge = await send(path, "POST", { productIds: [second.id, hidden.id], merge: true }, b, owner.id); assert.equal(merge.status, 200); const merged = await merge.json(); assert.deepEqual(merged.acceptedIds, [second.id]); assert.deepEqual(merged.skippedIds, [hidden.id]);
    const guest = await send("/api/wishlist/guest", "POST", { productIds: [first.id, hidden.id] }); assert.equal(guest.status, 200); const guestData = await guest.json(); assert.equal(guestData.items[1].product, null); assert.ok(!JSON.stringify(guestData).includes(hidden.name));
    await db.product.update({ where: { id: first.id }, data: { status: "REJECTED" } }); assert.equal((await read(b)).items.find((item) => item.id === first.id).product, null);
    phase = "private response headers and both real pages";
    const privateResponse = await send(path, "GET", undefined, a, owner.id); assert.equal(privateResponse.headers.get("cache-control"), "private, no-store"); assert.ok(privateResponse.headers.get("x-robots-tag")?.includes("noindex"));
    for (const page of ["/wishlist", "/user/wishlist"]) { const response = await send(page, "GET", undefined, a); assert.equal(response.status, 200); assert.ok((await response.text()).includes("My saved wishlist")); }
    phase = "owner-scoped removal and stale clear conflict";
    assert.equal((await send(path, "POST", { productIds: [second.id] }, foreign, other.id)).status, 200);
    assert.equal((await send(path, "DELETE", { productIds: [first.id] }, a, owner.id)).status, 200); assert.equal((await read(b)).total, 1);
    assert.equal((await send(path, "DELETE", { clear: true, version: initial.version }, b, owner.id)).status, 409);
    assert.equal((await send(path, "DELETE", { clear: true, version: (await read(a)).version }, b, owner.id)).status, 200); assert.equal((await read(a)).total, 0); assert.equal((await read(foreign, other.id)).total, 1);
    phase = "real copied-cookie revocation";
    await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
    for (const cookie of [a, b]) assert.equal((await send(path, "GET", undefined, cookie, owner.id)).status, 401);
    return { realTwoSessionWishlistSync: "PASS", ownerAndQueuedRequestIsolation: "PASS", currentCatalogPriceStock: "PASS", additiveMergeAndHiddenMetadata: "PASS", idempotentAddRemoveAndStaleClear: "PASS", privateHeadersAndBothPages: "PASS", ingressOriginAndRevocation: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try {
      const users = [owner?.id, other?.id, seller?.id].filter(Boolean);
      if (users.length) await db.wishlist.deleteMany({ where: { userId: { in: users } } });
      if (seller) await db.product.deleteMany({ where: { sellerId: seller.id } }); if (category) await db.category.delete({ where: { id: category.id } });
      if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && typeof error.actual === "number" && typeof error.expected === "number" ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Wishlist smoke failed during ${phase}${detail}. Private child output and session values were not published.`); process.exitCode = 1; });
