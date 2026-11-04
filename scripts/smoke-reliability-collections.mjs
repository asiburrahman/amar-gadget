import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";

let phase = "isolated database setup";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db;
  let child, redis;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex");
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [buyer, seller, foreign, admin] = await Promise.all(["USER", "MEMBER", "MEMBER", "ADMIN"].map((role) => db.user.create({ data: { email: `${randomUUID()}@collections-smoke.example.invalid`, password: hash, role, isVerified: true, sellerStatus: "APPROVED" } })));
    const category = await db.category.create({ data: { name: "Native collections category", slug: randomUUID() } });
    await db.product.createMany({ data: Array.from({ length: 24 }, (_, index) => ({ name: `Native seller gadget ${index}`, slug: randomUUID(), sellerId: seller.id, categoryId: category.id, price: 100, stock: 50, status: index < 21 ? "APPROVED" : "PENDING_APPROVAL" })) });
    const product = await db.product.findFirstOrThrow({ where: { sellerId: seller.id, status: "APPROVED" } });
    await db.product.update({ where: { id: product.id }, data: { name: "Original 50%_gadget" } });
    for (let index = 0; index < 23; index++) await db.order.create({ data: { userId: buyer.id, total: 100, status: index < 21 ? "PENDING" : index === 21 ? "DELIVERED" : "CANCELLED", items: { create: { productId: product.id, quantity: 1, price: 100 } } } });
    await db.product.update({ where: { id: product.id }, data: { name: "Renamed live gadget" } });
    const foreignProduct = await db.product.create({ data: { name: "Other seller private item", slug: randomUUID(), sellerId: foreign.id, categoryId: category.id, price: 100, stock: 10, status: "APPROVED" } });
    await db.order.create({ data: { userId: foreign.id, total: 100, items: { create: { productId: foreignProduct.id, quantity: 1, price: 100 } } } });
    const childCategories = [];
    for (let index = 0; index < 28; index++) childCategories.push(await db.category.create({ data: { name: `Native choice ${String(index).padStart(2, "0")}`, slug: randomUUID(), parentId: category.id } }));
    await db.product.update({ where: { id: foreignProduct.id }, data: { categoryId: childCategories.at(-1).id } });
    await db.brand.createMany({ data: Array.from({ length: 28 }, (_, index) => ({ name: `Native brand ${String(index).padStart(2, "0")}`, slug: randomUUID() })) });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target }), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (actor) => { const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    phase = "real account authentication";
    const buyerCookie = await login(buyer), sellerCookie = await login(seller), foreignCookie = await login(foreign), adminCookie = await login(admin);
    const find = (value, predicate) => { if (!value || typeof value !== "object") return null; if (predicate(value)) return value; for (const nested of Object.values(value)) { const found = find(nested, predicate); if (found) return found; } return null; };
    const page = async (target, cookie, predicate) => {
      let response = await send(target, "GET", undefined, cookie, { RSC: "1" });
      if (response.status === 307) {
        const location = new URL(response.headers.get("location"), child.origin), original = new URL(target, child.origin);
        assert.equal(location.origin, child.origin); assert.equal(location.pathname, original.pathname); assert.ok(location.searchParams.has("_rsc"));
        response = await send(location.pathname + location.search, "GET", undefined, cookie, { RSC: "1" });
      }
      assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) {
        if (!/^[a-f0-9]+:/.test(line)) continue;
        let value; try { value = JSON.parse(line.slice(line.indexOf(":") + 1)); } catch { continue; }
        const result = find(value, predicate); if (result) return result;
      }
      throw new Error("Compiled collection props were not found");
    };
    phase = "compiled customer pages and historical-label search";
    const ownOrders = (value) => value.user?.id === buyer.id && Array.isArray(value.initialOrders);
    const first = await page("/user/orders", buyerCookie, ownOrders), second = await page("/user/orders?page=2", buyerCookie, ownOrders);
    assert.equal(first.initialOrders.length, 20); assert.equal(second.initialOrders.length, 3);
    assert.equal(new Set([...first.initialOrders, ...second.initialOrders].map((row) => row.id)).size, 23);
    assert.deepEqual(first.counts, { ALL: 23, ACTIVE: 21, DELIVERED: 1, CANCELLED: 1 });
    assert.ok(first.initialOrders.every((order) => order.items[0].product.name === "Original 50%_gadget"));
    const matched = await page("/user/orders?q=50%25_&status=DELIVERED", buyerCookie, ownOrders);
    assert.equal(matched.initialOrders.length, 1); assert.equal(matched.query.status, "DELIVERED");
    phase = "compiled private API pages, validation and foreign-account isolation";
    const apiResponse = await send("/api/orders?page=2", "GET", undefined, buyerCookie), api = await apiResponse.json();
    assert.equal(apiResponse.status, 200); assert.ok(apiResponse.headers.get("cache-control").includes("no-store"));
    assert.deepEqual(api.pagination, { total: 23, page: 2, pageSize: 20, totalPages: 2 }); assert.equal(api.orders.length, 3);
    const foreignResponse = await send("/api/orders", "GET", undefined, foreignCookie); assert.equal((await foreignResponse.json()).pagination.total, 1);
    assert.equal((await send("/api/orders?page=3", "GET", undefined, buyerCookie)).status, 400);
    assert.equal((await send(`/api/orders?userId=${foreign.id}`, "GET", undefined, buyerCookie)).status, 400);
    phase = "compiled seller pages, all-catalog counts and status controls";
    const ownCatalog = (value) => value.seller?.id === seller.id && value.catalogPage;
    const catalog = await page("/member/dashboard?status=ALL", sellerCookie, ownCatalog), next = await page("/member/dashboard?status=ALL&page=2", sellerCookie, ownCatalog);
    assert.equal(catalog.initialMainTab, "CATALOG"); assert.equal(catalog.products.length, 20); assert.equal(next.products.length, 4);
    assert.deepEqual(catalog.catalogPage.counts, { ALL: 24, APPROVED: 21, PENDING: 3 });
    assert.equal(new Set([...catalog.products, ...next.products].map((row) => row.id)).size, 24);
    const pending = await page("/member/dashboard?status=PENDING", sellerCookie, ownCatalog);
    assert.equal(pending.products.length, 3); assert.ok(pending.products.every((row) => row.status === "PENDING_APPROVAL"));
    const otherCatalog = await page("/member/dashboard?status=ALL", foreignCookie, (value) => value.seller?.id === foreign.id && value.catalogPage);
    assert.equal(otherCatalog.catalogPage.total, 1);
    phase = "compiled administrator order pages and whole-market summary";
    const adminOrders = (value) => value.ownerId === admin.id && Array.isArray(value.initialOrders) && value.pageData;
    const platform = await page("/admin/orders", adminCookie, adminOrders), platformNext = await page("/admin/orders?page=2", adminCookie, adminOrders);
    assert.equal(platform.initialOrders.length, 20); assert.equal(platformNext.initialOrders.length, 4);
    assert.equal(new Set([...platform.initialOrders, ...platformNext.initialOrders].map((row) => row.id)).size, 24);
    assert.deepEqual(platform.pageData.summary, { orders: 24, pending: 22, delivered: 1, netFullyCollectedCents: 0, partiallyCollectedCodOrders: 0 });
    const buyerSearch = await page(`/admin/orders?q=${encodeURIComponent(buyer.email)}&status=PENDING&page=2`, adminCookie, adminOrders);
    assert.equal(buyerSearch.initialOrders.length, 1); assert.equal(buyerSearch.pageData.total, 21); assert.equal(buyerSearch.pageData.summary.orders, 24);
    assert.equal(buyerSearch.initialOrders[0].items[0].product.name, "Original 50%_gadget");
    assert.ok(Number.isSafeInteger(buyerSearch.initialOrders[0].fulfillmentVersion));
    assert.ok(!JSON.stringify(buyerSearch.initialOrders).includes(foreign.email));
    phase = "compiled bounded taxonomy APIs and full ancestor labels";
    const categoryResponse = await send("/api/categories?page=2"), categoryChoices = await categoryResponse.json();
    assert.equal(categoryResponse.status, 200); assert.equal(categoryChoices.categories.length, 4); assert.equal(categoryChoices.pagination.total, 29);
    assert.ok(categoryChoices.categories.every((choice) => choice.pathLabel.startsWith(category.name)));
    const brandResponse = await send("/api/brands?page=2"), brandChoices = await brandResponse.json(); assert.equal(brandResponse.status, 200); assert.equal(brandChoices.brands.length, 3); assert.equal(brandChoices.pagination.total, 28);
    assert.equal((await send("/api/categories?page=0")).status, 400);
    phase = "compiled category/product pages with independent complete counts";
    const showcase = (value) => value.navigation && Array.isArray(value.allProducts);
    const publicFirst = await page(`/categories?categoryId=${category.id}`, undefined, showcase), publicSecond = await page(`/categories?categoryId=${category.id}&page=2&categoryPage=2`, undefined, showcase);
    assert.equal(publicFirst.navigation.total, 22); assert.equal(publicFirst.allProducts.length, 12); assert.equal(publicSecond.allProducts.length, 10);
    assert.equal(new Set([...publicFirst.allProducts, ...publicSecond.allProducts].map((row) => row.id)).size, 22);
    const selectedLeaf = await page(`/categories?categoryId=${childCategories.at(-1).id}&q=absent`, undefined, showcase);
    assert.equal(selectedLeaf.allProducts.length, 1); assert.equal(selectedLeaf.allProducts[0].id, foreignProduct.id);
    assert.equal(selectedLeaf.categories.length, 1); assert.equal(selectedLeaf.categories[0].pathLabel, category.name + " / Native choice 27");
    phase = "compiled revoked-session handling";
    await db.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal((await send("/api/orders", "GET", undefined, buyerCookie)).status, 401);
    return { compiledCustomerPagesAndOriginalPurchaseLabels: "PASS", compiledPrivateOrderApiAndIsolation: "PASS", compiledSellerPagesAndWholeCatalogCounts: "PASS", compiledAdministratorPagesAndWholeMarketSummary: "PASS", compiledTaxonomyPagesAndFullPaths: "PASS", compiledCategoryProductPagesAndDescendants: "PASS", compiledSessionRevocation: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`Reliability collection smoke failed during ${phase}: ${error?.code === "ERR_ASSERTION" ? error.message : "private diagnostic withheld"}. Private server output and credentials were not published.`); process.exitCode = 1; });
