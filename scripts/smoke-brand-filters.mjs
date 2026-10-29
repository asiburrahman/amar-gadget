import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";

let phase = "fixture setup";
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search) throw new Error("Use an isolated local audit_* database.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }) });
  const prefix = `audit-brand-http-${randomUUID()}`, secret = randomBytes(32).toString("hex");
  let child, redis, seller, blocked;
  const brands = [], categories = [], products = [], orders = [];
  try {
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    for (const name of ["Apple", "Pineapple"]) brands.push(await db.brand.create({ data: { name: `000-${prefix} ${name}`, slug: `${prefix}-${name.toLowerCase()}` } }));
    for (const name of ["phones", "audio"]) categories.push(await db.category.create({ data: { name: `${prefix}-${name}`, slug: `${prefix}-${name}` } }));
    for (const [suffix, extra] of [["apple-phone", { discountPrice: 90 }], ["apple-audio", { categoryId: categories[1].id }], ["pineapple-phone", { brandId: brands[1].id }], ["unbranded", { brandId: null }], ["pending", { status: "PENDING_APPROVAL" }], ["blocked", { sellerId: blocked.id }]]) products.push(await db.product.create({ data: { name: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`, price: 100, stock: 1, sellerId: seller.id, categoryId: categories[0].id, brandId: brands[0].id, status: "APPROVED", ...extra } }));
    for (const [product, quantity, status, paymentStatus] of [[products[1], 3, "DELIVERED", "PAID"], [products[0], 99, "CANCELLED", "PAID"], [products[2], 99, "DELIVERED", "UNPAID"]]) {
      orders.push(await db.order.create({ data: { userId: seller.id, total: 100, status, paymentStatus, items: { create: { productId: product.id, quantity, price: 1 } } } }));
    }
    await db.product.update({ where: { id: products[0].id }, data: { specifications: [{ label: "Screen", value: "OLED" }] } });
    await db.product.update({ where: { id: products[1].id }, data: { specifications: [{ label: "screen", value: "LCD" }, { label: "Memory", value: "16 GB" }] } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    phase = "prepared server startup";
    child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    const get = (path) => requestHttp(child.origin + path, { headers: signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method: "GET", target: path }) });
    assert.equal((await get("/api/health")).status, 200);
    phase = "canonical directory links";
    const directory = await get("/brands"); assert.equal(directory.status, 200);
    const directoryHtml = await directory.text(); assert.ok(directoryHtml.includes(`/products?brand=${brands[0].slug}`)); assert.ok(!directoryHtml.includes("120+ Products"));
    phase = "slug and ID API filters";
    for (const query of [{ brand: brands[0].slug }, { brandId: brands[0].id }, { brand: brands[0].slug.toUpperCase() }]) {
      const response = await get(`/api/products?${new URLSearchParams({ ...query, search: prefix })}`);
      assert.equal(response.status, 200); const body = await response.json();
      assert.deepEqual(body.products.map((item) => item.id).sort(), [products[0].id, products[1].id].sort());
      assert.equal(body.total, 2); assert.equal(body.brandFilter.brand.slug, brands[0].slug);
    }
    phase = "rendered brand collection and combined predicates";
    const page = await get(`/products?${new URLSearchParams({ brand: brands[0].slug, categoryId: categories[0].id, search: prefix, filter: "sale" })}`);
    assert.equal(page.status, 200); const html = await page.text();
    assert.ok(html.includes(`${brands[0].name} Collection`)); assert.ok(html.includes(products[0].name));
    for (const product of products.slice(1)) assert.ok(!html.includes(product.name));
    assert.ok(html.includes("Clear brand filter"));
    phase = "missing and invalid brand isolation";
    const missing = await get(`/api/products?brand=${prefix}-missing&search=${prefix}`);
    assert.equal(missing.status, 200); assert.deepEqual((await missing.json()).products, []);
    const emptyPage = await get(`/products?brand=${prefix}-missing`); assert.equal(emptyPage.status, 200);
    const emptyHtml = await emptyPage.text(); assert.ok(emptyHtml.includes("Brand not found")); assert.ok(!emptyHtml.includes(products[0].name));
    assert.equal((await get(`/api/products?brand=${brands[0].slug}&brandId=${brands[1].id}`)).status, 400);
    assert.equal((await get(`/api/products?brand=${brands[0].slug}&brand=${brands[1].slug}`)).status, 400);
    phase = "bounded pages, prices and real sales ranking";
    const query = new URLSearchParams({ search: prefix, brand: brands[0].slug, limit: "1", sort: "price_low" });
    const first = await (await get(`/api/products?${query}`)).json();
    assert.equal(first.total, 2); assert.equal(first.totalPages, 2); assert.equal(first.products.length, 1); assert.equal(first.products[0].id, products[0].id); assert.equal(first.products[0].effectivePrice, 90);
    query.set("page", "2"); const second = await (await get(`/api/products?${query}`)).json(); assert.equal(second.products[0].id, products[1].id);
    const filteredPage = await (await get(`/products?${query}`)).text();
    assert.ok(filteredPage.includes('aria-label="Product filters"')); assert.ok(filteredPage.includes("Previous page")); assert.ok(filteredPage.includes("of 2 products")); assert.ok(!filteredPage.includes('name="page"'));
    for (const name of ["minPrice", "maxPrice", "brandId", "categoryId", "sort", "limit"]) assert.ok(filteredPage.includes(`name="${name}"`));
    const ranked = await (await get(`/api/products?search=${prefix}&sort=bestsellers`)).json(); assert.equal(ranked.products[0].id, products[1].id); assert.equal(ranked.products[0].unitsSold, "3"); assert.equal(ranked.products.find((p) => p.id === products[0].id).unitsSold, "0");
    const priced = await (await get(`/api/products?search=${prefix}&maxPrice=95`)).json(); assert.deepEqual(priced.products.map((p) => p.id), [products[0].id]);
    assert.equal((await get("/api/products?minPrice=10&maxPrice=1")).status, 400); assert.equal((await get("/api/products?limit=49")).status, 400);
    const far = await (await get(`/api/products?search=${prefix}&page=1000000`)).json(); assert.equal(far.outOfRange, true); assert.deepEqual(far.products, []);
    const choices = await get(`/api/catalog/options?kind=brand&search=${prefix}`); assert.equal(choices.status, 200); assert.equal((await choices.json()).total, 2);
    phase = "home page actual best-seller wiring";
    const home = await (await get("/")).text(); const section = home.split('aria-label="Best sellers"')[1]?.split("</section>")[0]; assert.ok(section); assert.ok(section.includes(products[1].name)); assert.ok(!section.includes(products[0].name));
    phase = "advertised search destination and real comparison specs";
    const search = await get(`/search?${new URLSearchParams({ q: prefix, categoryId: categories[0].id })}`);
    // Installed Next emits an explicit refresh destination after a streaming
    // layout has sent 200; non-streaming requests can still return 307.
    assert.ok([200, 307].includes(search.status));
    const searchHtml = search.status === 200 ? await search.text() : "";
    const location = search.headers.get("location") ?? searchHtml.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[01];url=([^"]+)"/i)?.[1]?.replaceAll("&amp;", "&");
    phase = "search streaming redirect destination";
    assert.ok(location?.startsWith("/products?"));
    const redirected = new URL(location, child.origin); assert.equal(redirected.searchParams.get("search"), prefix); assert.equal(redirected.searchParams.get("categoryId"), categories[0].id);
    phase = "canonical search filtered results";
    const actualResults = await (await get(redirected.pathname + redirected.search)).text(); assert.ok(actualResults.includes(products[0].name)); assert.ok(!actualResults.includes(products[1].name));
    const compareQuery = new URLSearchParams(); for (const product of [products[0], products[1], products[4], products[5]]) compareQuery.append("product", product.id);
    phase = "rendered comparison specs and visibility";
    const compared = await get(`/compare?${compareQuery}`); assert.equal(compared.status, 200); const comparedHtml = await compared.text();
    const table = comparedHtml.match(/<table[\s\S]*?<\/table>/)?.[0]; assert.ok(table);
    for (const value of ["OLED", "LCD", "16 GB", "Not supplied"]) assert.ok(table.includes(value));
    const visibleComparison = comparedHtml.replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(visibleComparison.includes("2 selected products are unavailable")); assert.ok(visibleComparison.includes("Remove product 4"));
    assert.ok(!comparedHtml.includes(products[4].name)); assert.ok(!comparedHtml.includes(products[5].name));
    phase = "detail specifications and header search forms";
    const detail = await (await get(`/products/${products[0].slug}`)).text(); assert.ok(detail.includes("Technical specifications")); assert.ok(detail.includes("OLED")); assert.ok(detail.includes("to comparison"));
    assert.ok(home.includes('action="/search"')); assert.ok(home.includes('name="q"')); assert.ok(home.includes('name="category"'));
    const duplicate = await (await get(`/compare?product=${products[0].id}&product=${products[0].id}`)).text(); assert.ok(duplicate.includes("four distinct product IDs"));
    return { actualBrandDirectoryLinks: "PASS", slugIdAndCaseAliases: "PASS", approvedSellerVisibility: "PASS", combinedBrandCategorySearchSale: "PASS", namedCollectionServerRender: "PASS", missingBrandEmptyState: "PASS", conflictingAndRepeatedFiltersRejected: "PASS", boundedPagesAndExactCount: "PASS", effectivePriceRangeAndSort: "PASS", renderedFilterControls: "PASS", paidDeliveredSalesRanking: "PASS", liveOptionEndpoint: "PASS", homepageBestSellers: "PASS", unifiedSearchRedirect: "PASS", realComparisonSpecifications: "PASS", hiddenComparisonProductsDenied: "PASS", productDetailSpecifications: "PASS", actualHeaderSearchForms: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    await db.orderItem.deleteMany({ where: { orderId: { in: orders.map((item) => item.id) } } });
    await db.order.deleteMany({ where: { id: { in: orders.map((item) => item.id) } } });
    try { await db.product.deleteMany({ where: { id: { in: products.map((item) => item.id) } } }); await db.brand.deleteMany({ where: { id: { in: brands.map((item) => item.id) } } }); await db.category.deleteMany({ where: { id: { in: categories.map((item) => item.id) } } }); if (seller) await db.user.delete({ where: { id: seller.id } }); if (blocked) await db.user.delete({ where: { id: blocked.id } }); } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : "";
  console.error(`Brand-filter HTTP smoke failed during ${phase}${detail}. Private child output was not published.`); process.exitCode = 1;
});
