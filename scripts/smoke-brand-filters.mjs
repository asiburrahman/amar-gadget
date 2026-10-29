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
  const brands = [], categories = [], products = [];
  try {
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    for (const name of ["Apple", "Pineapple"]) brands.push(await db.brand.create({ data: { name: `000-${prefix} ${name}`, slug: `${prefix}-${name.toLowerCase()}` } }));
    for (const name of ["phones", "audio"]) categories.push(await db.category.create({ data: { name: `${prefix}-${name}`, slug: `${prefix}-${name}` } }));
    for (const [suffix, extra] of [["apple-phone", { discountPrice: 90 }], ["apple-audio", { categoryId: categories[1].id }], ["pineapple-phone", { brandId: brands[1].id }], ["unbranded", { brandId: null }], ["pending", { status: "PENDING_APPROVAL" }], ["blocked", { sellerId: blocked.id }]]) products.push(await db.product.create({ data: { name: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`, price: 100, stock: 1, sellerId: seller.id, categoryId: categories[0].id, brandId: brands[0].id, status: "APPROVED", ...extra } }));
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
    return { actualBrandDirectoryLinks: "PASS", slugIdAndCaseAliases: "PASS", approvedSellerVisibility: "PASS", combinedBrandCategorySearchSale: "PASS", namedCollectionServerRender: "PASS", missingBrandEmptyState: "PASS", conflictingAndRepeatedFiltersRejected: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try { await db.product.deleteMany({ where: { id: { in: products.map((item) => item.id) } } }); await db.brand.deleteMany({ where: { id: { in: brands.map((item) => item.id) } } }); await db.category.deleteMany({ where: { id: { in: categories.map((item) => item.id) } } }); if (seller) await db.user.delete({ where: { id: seller.id } }); if (blocked) await db.user.delete({ where: { id: blocked.id } }); } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : "";
  console.error(`Brand-filter HTTP smoke failed during ${phase}${detail}. Private child output was not published.`); process.exitCode = 1;
});
