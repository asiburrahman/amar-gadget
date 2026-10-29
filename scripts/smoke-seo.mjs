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
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search || url.hash) throw new Error("Use an isolated local audit_* database.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }) });
  const prefix = `audit-seo-http-${randomUUID()}`, secret = randomBytes(32).toString("hex"), products = [];
  let seller, blocked, category, brand, redis, child;
  try {
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "BLOCKED" } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } }); brand = await db.brand.create({ data: { name: prefix, slug: prefix } });
    for (const name of ["live", "zero", "pending", "blocked"]) products.push(await db.product.create({ data: { name: name === "live" ? `${prefix}</script><script>alert(1)</script>` : `Private test name ${name} ${randomUUID()}`, slug: `${prefix}-${name}`, description: "Current catalog details", price: 100, discountPrice: 80, stock: name === "zero" ? 0 : 3, status: name === "pending" ? "PENDING_APPROVAL" : "APPROVED", sellerId: name === "blocked" ? blocked.id : seller.id, categoryId: category.id, brandId: brand.id, imageUrl: "/file.svg" } }));
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    const origins = [];
    for (let pass = 0; pass < 2; pass++) {
      phase = `prepared server ${pass + 1} startup`;
      child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret, NEXT_PUBLIC_APP_URL: "https://ignored-build-alias.invalid" }); origins.push(child.origin);
      const get = (target) => requestHttp(child.origin + target, { headers: { "User-Agent": "Googlebot", ...signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method: "GET", target }) } });
      phase = "runtime robots and sitemap index";
      const robots = await get("/robots.txt"); assert.equal(robots.status, 200); assert.ok((await robots.text()).includes(`Sitemap: ${child.origin}/sitemap.xml`));
      const index = await get("/sitemap.xml"); assert.equal(index.status, 200); assert.ok(index.headers.get("content-type").includes("application/xml"));
      const indexXml = await index.text(); assert.ok(indexXml.includes(`${child.origin}/sitemaps/products-0.xml`)); assert.ok(!indexXml.includes("ignored-build-alias"));
      const shard = await get("/sitemaps/products-0.xml"); assert.equal(shard.status, 200); const xml = await shard.text();
      for (const product of products.slice(0, 2)) assert.ok(xml.includes(`${child.origin}/products/${product.slug}`)); for (const product of products.slice(2)) assert.ok(!xml.includes(product.slug));
      assert.equal((await get("/sitemaps/products-99999.xml")).status, 404);
      phase = "category canonical and paginated directory noindex";
      const categoryHtml = await (await get(`/categories/${category.slug}`)).text(); assert.ok(categoryHtml.includes(`rel="canonical" href="${child.origin}/categories/${category.slug}"`));
      const facetHtml = await (await get(`/products?categoryId=${category.id}`)).text(); assert.ok(facetHtml.includes(`rel="canonical" href="${child.origin}/categories/${category.slug}"`));
      const directory = await (await get("/brands?page=2")).text(); assert.ok(directory.includes(`rel="canonical" href="${child.origin}/brands?page=2"`)); assert.ok(/name="robots" content="[^"]*noindex/.test(directory));
      phase = "actual product canonical, Open Graph and JSON-LD";
      for (const product of products.slice(0, 2)) {
        const response = await get(`/products/${product.slug}`); assert.equal(response.status, 200); const html = await response.text();
        assert.ok(html.includes(`rel="canonical" href="${child.origin}/products/${product.slug}"`)); assert.ok(html.includes(`property="og:url" content="${child.origin}/products/${product.slug}"`));
        const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1])); const schema = schemas.find((item) => item["@type"] === "Product"); assert.ok(schema);
        assert.equal(schema.offers.url, `${child.origin}/products/${product.slug}`); assert.equal(schema.offers.price, 80); assert.equal(schema.offers.priceCurrency, "BDT"); assert.equal(schema.offers.availability, `https://schema.org/${product.stock ? "InStock" : "OutOfStock"}`); assert.equal(schema.offers.priceValidUntil, undefined); assert.equal(schema.offers.itemCondition, undefined); assert.equal(schema.image[0], child.origin + "/file.svg"); assert.ok(!html.includes("<script>alert(1)</script>"));
      }
      phase = "canonical ID/case redirects and hidden product noindex";
      for (const alias of [products[0].id, products[0].slug.toUpperCase()]) {
        const response = await get(`/products/${alias}`); assert.ok([200, 308].includes(response.status));
        const html = response.status === 200 ? await response.text() : ""; const target = response.headers.get("location") ?? html.match(/http-equiv="refresh"[^>]*content="[01];url=([^"]+)"/)?.[1]; assert.equal(target, `/products/${products[0].slug}`);
      }
      for (const product of products.slice(2)) {
        const response = await get(`/products/${product.slug}`); assert.ok([200, 404].includes(response.status)); const html = await response.text(); assert.ok(/name="robots" content="[^"]*noindex/.test(html)); assert.ok(!html.includes(product.name));
        assert.equal((await get(`/api/products/${product.slug}`)).status, 404);
      }
      phase = "private flow response headers and homepage schema";
      for (const path of ["/login", "/cart", "/checkout", "/order-success", "/track-order", "/wishlist", "/compare", "/api/products", "/admin"]) assert.equal((await get(path)).headers.get("x-robots-tag"), "noindex, nofollow");
      phase = "homepage runtime canonical and actual schema";
      const home = await (await get("/")).text(); const href = home.match(/<link rel="canonical" href="([^"]+)"/)?.[1]; assert.ok(href); assert.equal(new URL(href).href, child.origin + "/"); const schemas = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
      assert.equal(schemas.find((item) => item["@type"] === "WebSite").url, child.origin + "/"); assert.equal(schemas.find((item) => item["@type"] === "Organization").contactPoint, undefined);
      await child.stop(); child = undefined;
    }
    assert.notEqual(origins[0], origins[1]);
    phase = "actual database-outage product metadata and API";
    const unavailable = new URL(url); unavailable.port = "1";
    child = await startStandaloneFixture(unavailable.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    const getUnavailable = (target) => requestHttp(child.origin + target, { headers: { "User-Agent": "Googlebot", ...signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method: "GET", target }) } });
    const outage = await getUnavailable(`/products/${products[0].slug}`); assert.ok([200, 500].includes(outage.status)); const outageHtml = await outage.text(); assert.ok(/name="robots" content="[^"]*noindex/.test(outageHtml)); assert.ok(!outageHtml.includes("ECONNREFUSED")); assert.ok(!outageHtml.includes("postgresql://"));
    assert.equal((await getUnavailable(`/api/products/${products[0].slug}`)).status, 503);
    return { runtimeOriginsSameArtifact: "PASS", robotsAndSitemapRoutes: "PASS", visibleCatalogXml: "PASS", productCanonicalAndOg: "PASS", actualStockPriceJsonLd: "PASS", escapedProductText: "PASS", idAndCaseRedirects: "PASS", hiddenProductNoindex: "PASS", privateFlowNoindexHeaders: "PASS", homepageOrganizationWebsiteSchema: "PASS", actualDatabaseOutageNoindexAnd503: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try { await db.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } }); if (brand) await db.brand.delete({ where: { id: brand.id } }); if (category) await db.category.delete({ where: { id: category.id } }); if (seller) await db.user.delete({ where: { id: seller.id } }); if (blocked) await db.user.delete({ where: { id: blocked.id } }); } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : ""; console.error(`SEO HTTP smoke failed during ${phase}${detail}. Private child output was not published.`); process.exitCode = 1; });
