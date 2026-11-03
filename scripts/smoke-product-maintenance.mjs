import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "new isolated migration fixture";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [seller, other, admin, buyer] = await Promise.all(["MEMBER", "MEMBER", "ADMIN", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@catalog-smoke.example.invalid`, password: hash, role, sellerStatus: "APPROVED", isVerified: true } })));
    const category = await db.category.create({ data: { name: "Maintenance smoke category", slug: randomUUID() } });
    const product = await db.product.create({ data: { name: "Original purchased smoke gadget", slug: randomUUID(), price: 100, stock: 10, status: "APPROVED", sellerId: seller.id, categoryId: category.id, imageUrl: "https://cdn.example.invalid/front.png", images: ["https://cdn.example.invalid/front.png", "https://cdn.example.invalid/back.png"] } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (actor) => { const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    phase = "real logins, ownership and private catalog pages";
    const own = await login(seller), foreign = await login(other), moderator = await login(admin), customer = await login(buyer), path = "/api/member/products", observed = { "X-Product-Owner": seller.id };
    const read = async (query = "", cookie = own, header = observed) => { const response = await send(path + query, "GET", undefined, cookie, header); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); return response.json(); };
    const initial = await read(); assert.equal(initial.total, 1); assert.equal(initial.rows[0].id, product.id);
    assert.equal((await send(path, "GET", undefined, foreign, observed)).status, 409); assert.equal((await send(path, "GET", undefined, customer, { "X-Product-Owner": buyer.id })).status, 403);
    for (const route of ["/member/products", "/member/orders"]) { const response = await send(route, "GET", undefined, own); assert.equal(response.status, 200); assert.ok((await response.text()).includes(route.endsWith("products") ? "Your product catalog" : "My seller shipments")); }
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const call = async (name, args, cookie, route, worker) => {
      const reference = Object.entries(manifest.node).find(([, value]) => value.exportedName === name && value.workers?.[worker]); assert.ok(reference, `Missing compiled action ${name}`);
      const response = await requestHttp(child.origin + route, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Content-Type": "text/plain;charset=UTF-8", "Next-Action": reference[0], ...signature("POST", route) }, body: JSON.stringify(args) }); assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const value = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof value.success === "boolean") return value; } catch { /* Other Flight records. */ } }
      throw new Error("Compiled action returned no result.");
    };
    const identity = async () => { const current = await db.product.findUniqueOrThrow({ where: { id: product.id } }); return { id: product.id, version: current.catalogVersion, requestId: randomUUID(), reason: "Verified smoke warehouse/catalog operation" }; };
    const mutate = (body, cookie = own, header = observed) => send(path, "POST", body, cookie, header);
    const saved = async (body) => { const response = await mutate(body); assert.equal(response.status, 200); return response.json(); };
    const approve = (version) => call("updateProductStatus", [product.id, "APPROVED", version], moderator, "/admin/products", "app/(dashboard)/admin/products/page");
    const visible = async () => (await (await send("/api/products")).json()).products.some((row) => row.id === product.id);
    phase = "compiled COD checkout and real immutable purchase snapshot";
    const cartResponse = await send("/api/cart", "GET", undefined, customer, { "X-Cart-Owner": buyer.id }); assert.equal(cartResponse.status, 200); const cart = await cartResponse.json();
    assert.equal((await send("/api/cart", "POST", { action: "set", productId: product.id, lineId: null, quantity: 1, version: cart.version, requestId: randomUUID() }, customer, { "X-Cart-Owner": buyer.id })).status, 200);
    const snapshot = await (await send("/api/cart", "GET", undefined, customer, { "X-Cart-Owner": buyer.id })).json();
    const input = { fullName: "Maintenance test recipient", phone: "01700000000", street: "Fixture road 12", city: "Dhaka", district: "Dhaka", items: [{ productId: product.id, quantity: 1 }], paymentMethod: "COD", checkoutToken: randomBytes(32).toString("hex"), cart: { ownerId: buyer.id, sourceId: null, version: snapshot.version, couponCode: snapshot.couponCode, couponVersion: snapshot.couponVersion, previousReceiptId: null, lines: snapshot.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: 1 })) } };
    const purchase = await call("createOrder", [input], customer, "/checkout", "app/(marketing)/checkout/page"); assert.equal(purchase.success, true);
    const order = await db.order.findUniqueOrThrow({ where: { id: purchase.orderId }, include: { items: true, fulfillments: true } }); assert.equal(order.items[0].productName, product.name); assert.equal(order.items[0].productSnapshotSource, "PURCHASE"); assert.equal(order.fulfillments.length, 1);
    phase = "stale checkout inventory rejected; exact restock intent deduplicated";
    const stale = { id: product.id, version: 1, inventoryVersion: 1, requestId: randomUUID(), reason: "Received five verified units", action: "stock", delta: 5, confirmed: true }; assert.equal((await mutate(stale)).status, 409);
    const current = await db.product.findUniqueOrThrow({ where: { id: product.id } }), restock = { ...stale, requestId: randomUUID(), inventoryVersion: current.inventoryVersion };
    const restocked = await saved(restock); assert.equal(restocked.row.stock, 14); assert.equal((await saved(restock)).result.inventoryVersion, restocked.result.inventoryVersion); assert.equal((await mutate({ ...restock, delta: 6 })).status, 409);
    assert.equal((await mutate({ ...await identity(), action: "archive", confirmed: true }, foreign, { "X-Product-Owner": other.id })).status, 404);
    phase = "content review visibility, stale administrator rejection and large Unicode metadata";
    const beforeEdit = await db.product.findUniqueOrThrow({ where: { id: product.id } }), content = { name: "Renamed current catalog gadget", description: "\u0986".repeat(20_000), specifications: [{ label: "Storage", value: "512 GB" }], price: 125, discountPrice: 120, categoryId: category.id, brandId: null };
    const edited = await saved({ ...await identity(), action: "edit", fields: content }); assert.equal(edited.row.status, "PENDING_APPROVAL"); assert.equal(await visible(), false); assert.equal((await approve(beforeEdit.catalogVersion)).success, false); assert.equal((await approve(edited.row.catalogVersion)).success, true); assert.equal(await visible(), true);
    phase = "archive hides public discovery and checkout but retains bought labels and money";
    const archived = await saved({ ...await identity(), action: "archive", confirmed: true }); assert.equal(archived.row.status, "ARCHIVED"); assert.equal(await visible(), false); assert.equal((await approve(archived.row.catalogVersion)).success, false);
    assert.equal((await send("/api/checkout/quote", "POST", { items: [{ productId: product.id, quantity: 1 }] }, customer)).status, 422);
    const confirmation = await send(`/api/checkout/${order.id}`, "GET", undefined, customer); assert.equal(confirmation.status, 200); const captured = await confirmation.json(); assert.ok(JSON.stringify(captured).includes(product.name)); assert.ok(!JSON.stringify(captured).includes(content.name));
    const retained = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, fulfillments: true } }); assert.deepEqual(retained, order);
    phase = "compiled gallery keeps archive; explicit resubmission and history receipts";
    const gallery = await call("replaceProductGallery", [{ productId: product.id, version: 1, items: [{ source: "existing", url: product.images[1] }, { source: "existing", url: product.images[0] }] }], own, `/member/products/${product.id}/images`, "app/(dashboard)/member/products/[id]/images/page"); assert.equal(gallery.success, true); assert.equal(gallery.data.status, "ARCHIVED");
    const restored = await saved({ ...await identity(), action: "resubmit", confirmed: true }); assert.equal(restored.row.status, "PENDING_APPROVAL"); assert.equal(await visible(), false); assert.equal((await approve(restored.row.catalogVersion)).success, true);
    const history = await read(`?mode=history&id=${product.id}`); assert.ok(history.events.some((event) => event.reason === "Product gallery updated" && event.actorId === seller.id));
    const receipt = await read(`?q=absent&requestId=${restock.requestId}`); assert.equal(receipt.rows.length, 0); assert.equal(receipt.attempt.id, product.id); assert.equal(receipt.attemptedRow.status, "APPROVED");
    phase = "current session revocation and protected purchase retention";
    await assert.rejects(db.product.delete({ where: { id: product.id } })); await db.user.update({ where: { id: seller.id }, data: { sessionVersion: { increment: 1 } } }); assert.equal((await send(path, "GET", undefined, own, observed)).status, 403); assert.equal((await mutate({ ...await identity(), action: "archive", confirmed: true })).status, 403);
    return { migratedIsolatedDatabase: "PASS", realLoginAndOwnerPrivatePages: "PASS", compiledCodPurchaseSnapshot: "PASS", stockConflictAndExactReceipt: "PASS", unicodeContentReapprovalAndStaleAdmin: "PASS", archivePublicAndCheckoutExclusion: "PASS", purchaseLabelAndFinancialRetention: "PASS", compiledGalleryStaysArchived: "PASS", explicitResubmissionAndHistory: "PASS", revokedSessionAndForeignOwnerDenied: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((value) => console.log(JSON.stringify(value))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Product maintenance smoke failed during ${phase}${detail}; private provider/database output was not published.`); process.exitCode = 1; });
