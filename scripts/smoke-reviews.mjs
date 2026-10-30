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
  const prefix = `audit-reviews-smoke-${randomUUID()}`, secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex");
  let buyer, other, seller, secondSeller, admin, category, product, child, redis;
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    [buyer, other, seller, secondSeller, admin] = await Promise.all(["buyer", "other", "seller", "second-seller", "admin"].map((name) => db.user.create({ data: { email: `${prefix}-${name}@example.invalid`, name: `${name} Private-family-name`, password: hash, isVerified: true, role: name === "admin" ? "ADMIN" : name.includes("seller") ? "MEMBER" : "USER", sellerStatus: "APPROVED" } })));
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    product = await db.product.create({ data: { name: `${prefix} actual product`, slug: `${prefix}-product`, price: 100, stock: 5, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); phase = "prepared artifact startup"; child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, expectedOwner, ownerHeader = "X-Review-Owner") => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(expectedOwner ? { [ownerHeader]: expectedOwner } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (email) => { const response = await send("/api/auth/login", "POST", { email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const [a, b, foreign, vendor, foreignVendor, moderator] = await Promise.all([buyer, buyer, other, seller, secondSeller, admin].map((user) => login(user.email)));
    const path = "/api/user/reviews", accessPath = `${path}?productId=${product.id}`;
    const readPublic = async () => { const response = await send(`/api/reviews?productId=${product.id}`); assert.equal(response.status, 200); return response.json(); };
    const readAccess = async (cookie = a) => { const response = await send(accessPath, "GET", undefined, cookie, buyer.id); assert.equal(response.status, 200); return response.json(); };
    phase = "private session, ingress, Origin and expected-owner preconditions";
    assert.equal((await requestHttp(child.origin + path)).status, 403); assert.equal((await send(path)).status, 401); assert.equal((await send(path, "GET", undefined, foreign, buyer.id)).status, 409);
    assert.equal((await requestHttp(child.origin + path, { method: "POST", headers: { Cookie: a, Origin: "https://foreign.example.invalid", "X-Review-Owner": buyer.id, ...signature("POST", path) }, body: "{}" })).status, 403);
    assert.equal((await readAccess()).eligible, false);
    assert.equal((await send(path, "POST", { productId: product.id, rating: 5, comment: null }, a, buyer.id)).status, 403);
    phase = "actual account cart and compiled COD purchase";
    const cartResponse = await send("/api/cart", "GET", undefined, a, buyer.id, "X-Cart-Owner"); assert.equal(cartResponse.status, 200); const empty = await cartResponse.json();
    assert.equal((await send("/api/cart", "POST", { action: "set", productId: product.id, lineId: null, quantity: 1, version: empty.version, requestId: randomUUID() }, a, buyer.id, "X-Cart-Owner")).status, 200);
    const cart = await (await send("/api/cart", "GET", undefined, b, buyer.id, "X-Cart-Owner")).json();
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const action = (name, worker) => { const entry = Object.entries(manifest.node).find(([, value]) => value.exportedName === name && value.workers?.[worker]); assert.ok(entry); return entry[0]; };
    const call = async (target, reference, args, cookie) => {
      const response = await requestHttp(child.origin + target, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Next-Action": reference, "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", target) }, body: JSON.stringify(args) }); assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const item = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof item.success === "boolean") return item; } catch { /* Other Flight rows. */ } }
      throw new Error("Compiled action returned no result.");
    };
    const context = { ownerId: buyer.id, sourceId: null, version: cart.version, couponCode: null, couponVersion: cart.couponVersion, previousReceiptId: null, lines: cart.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: line.quantity })) };
    const checkout = await call("/checkout", action("createOrder", "app/(marketing)/checkout/page"), [{ cart: context, items: [{ productId: product.id, quantity: 1 }], fullName: "Native buyer", phone: "01700000000", street: "Review fixture road", city: "Dhaka", district: "Dhaka", paymentMethod: "COD", checkoutToken: randomBytes(32).toString("hex") }], a); assert.equal(checkout.success, true);
    assert.equal((await readAccess()).eligible, false);
    phase = "compiled authorized delivery and paid purchase eligibility";
    const groupsResponse = await send("/api/member/fulfillments?orderId=" + checkout.orderId, "GET", undefined, vendor, seller.id, "X-Fulfillment-Owner"); assert.equal(groupsResponse.status, 200); const group = (await groupsResponse.json()).shipments[0];
    assert.equal((await send("/api/member/fulfillments", "POST", { fulfillmentId: group.id, version: group.version, action: "ship", carrier: "Native courier", trackingNumber: "NATIVE-REVIEW" }, vendor, seller.id, "X-Fulfillment-Owner")).status, 200);
    const delivered = await send("/api/admin/fulfillments", "POST", { fulfillmentId: group.id, version: group.version + 1, action: "deliver", codMoneyReceived: true }, moderator, admin.id, "X-Fulfillment-Owner"); assert.equal(delivered.status, 200); assert.equal((await delivered.json()).shipment.paymentStatus, "PAID"); assert.equal((await readAccess(b)).eligible, true);
    phase = "real pending submission and cross-session owner/duplicate guards";
    const text = "Native <script>review-only</script> purchased product feedback";
    const submitted = await send(path, "POST", { productId: product.id, rating: 4, comment: text }, a, buyer.id); assert.equal(submitted.status, 201); let review = (await submitted.json()).review; assert.equal(review.status, "PENDING");
    assert.equal((await send(path, "POST", { productId: product.id, rating: 5, comment: "Duplicate" }, b, buyer.id)).status, 409);
    assert.equal((await send(path, "PUT", { id: review.id, version: review.version, rating: 1, comment: "Foreign edit" }, foreign, other.id)).status, 404);
    assert.equal((await readPublic()).total, 0); assert.equal((await (await send(`/api/products/${product.slug}`)).json()).product.reviews.length, 0);
    const moderate = async (value, decision, reason) => { const response = await send("/api/admin/reviews", "POST", { id: value.id, version: value.version, action: decision, ...(reason ? { reason } : {}) }, moderator, admin.id); assert.equal(response.status, 200); return (await response.json()).review; };
    phase = "real moderation, sanitized publication and rendered product text";
    assert.equal((await send("/api/admin/reviews", "POST", { id: review.id, version: review.version, action: "publish" }, a, buyer.id)).status, 403);
    review = await moderate(review, "publish"); const published = await readPublic(); assert.equal(published.total, 1); assert.equal(published.rating, 4); assert.equal(published.reviews[0].verifiedPurchase, true); assert.equal(published.reviews[0].displayName, "buyer");
    for (const privateValue of [buyer.email, buyer.id, "Private-family-name", "moderatedById", "orderItemId"]) assert.ok(!JSON.stringify(published).includes(privateValue));
    const htmlResponse = await send(`/products/${product.slug}`); assert.equal(htmlResponse.status, 200); const html = await htmlResponse.text(); assert.ok(html.includes("&lt;script&gt;review-only&lt;/script&gt;")); assert.ok(!html.includes("<script>review-only</script>")); assert.ok(html.includes("Customer reviews"));
    const sellerRows = await send("/api/member/reviews", "GET", undefined, vendor, seller.id); assert.equal(sellerRows.status, 200); assert.equal((await sellerRows.json()).reviews[0].id, review.id);
    assert.equal((await (await send("/api/member/reviews", "GET", undefined, foreignVendor, secondSeller.id)).json()).total, 0);
    phase = "edit/remoderation/stale decision/rejection and owner withdrawal";
    const previous = review;
    const edited = await send(path, "PUT", { id: review.id, version: review.version, rating: 2, comment: "Updated purchase experience" }, b, buyer.id); assert.equal(edited.status, 200); review = (await edited.json()).review; assert.equal(review.status, "PENDING"); assert.equal((await readPublic()).total, 0);
    assert.equal((await send("/api/admin/reviews", "POST", { id: previous.id, version: previous.version, action: "publish" }, moderator, admin.id)).status, 409);
    review = await moderate(review, "reject", "Please describe the purchased product."); assert.equal((await readAccess()).review.moderationReason, "Please describe the purchased product.");
    const resubmitted = await send(path, "PUT", { id: review.id, version: review.version, rating: 3, comment: "Explicit revised product feedback" }, a, buyer.id); assert.equal(resubmitted.status, 200); review = await moderate((await resubmitted.json()).review, "publish");
    assert.equal((await readPublic()).rating, 3); const counter = await db.product.findUniqueOrThrow({ where: { id: product.id } }); assert.equal(counter.rating, 3); assert.equal(counter.reviewCount, 1);
    const withdrawn = await send(path, "DELETE", { id: review.id, version: review.version }, b, buyer.id); assert.equal(withdrawn.status, 200); review = (await withdrawn.json()).review; assert.equal(review.status, "WITHDRAWN"); assert.equal((await readPublic()).total, 0);
    assert.equal((await send("/api/admin/reviews", "POST", { id: review.id, version: review.version, action: "publish" }, moderator, admin.id)).status, 409);
    phase = "legacy quarantine, real role pages and private/noindex headers";
    const legacy = await db.review.create({ data: { productId: product.id, userId: other.id, rating: 5, comment: "Unverified historical text", status: "LEGACY" } });
    assert.equal((await send("/api/admin/reviews", "POST", { id: legacy.id, version: legacy.version, action: "publish" }, moderator, admin.id)).status, 409); assert.equal((await readPublic()).total, 0);
    for (const [target, cookie, title] of [["/user/reviews", a, "My purchase reviews"], ["/admin/reviews", moderator, "Purchase review moderation"], ["/member/reviews", vendor, "Reviews of my products"]]) { const response = await send(target, "GET", undefined, cookie); assert.equal(response.status, 200); assert.ok((await response.text()).includes(title)); }
    const privateResponse = await send(path, "GET", undefined, a, buyer.id); assert.equal(privateResponse.headers.get("cache-control"), "private, no-store"); assert.ok(privateResponse.headers.get("x-robots-tag")?.includes("noindex"));
    phase = "copied-cookie revocation and current seller visibility";
    await db.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } }); for (const cookie of [a, b]) assert.equal((await send(path, "GET", undefined, cookie, buyer.id)).status, 401);
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); assert.equal((await send(`/api/reviews?productId=${product.id}`)).status, 404);
    return { compiledCodAndDeliveredEligibility: "PASS", realPendingReviewAndOnePerProduct: "PASS", currentOwnerRoleAndCrossSessionGuards: "PASS", actualModerationAndRatingAggregates: "PASS", renderedEscapedPurchaseFeedback: "PASS", editedStaleRejectedAndWithdrawnStates: "PASS", sellerScopeAndLegacyQuarantine: "PASS", privateRolePagesOriginIngressAndRevocation: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try {
      const users = [buyer?.id, other?.id, seller?.id, secondSeller?.id, admin?.id].filter(Boolean);
      if (product) await db.review.deleteMany({ where: { productId: product.id } });
      if (users.length) { await db.orderItem.deleteMany({ where: { order: { userId: { in: users } } } }); await db.order.deleteMany({ where: { userId: { in: users } } }); }
      if (product) await db.product.delete({ where: { id: product.id } }); if (category) await db.category.delete({ where: { id: category.id } }); if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && typeof error.actual === "number" && typeof error.expected === "number" ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Reviews smoke failed during ${phase}${detail}. Private child output, credentials and action manifest keys were not published.`); process.exitCode = 1; });
