jest.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, permanentRedirect: (path: string) => { throw new Error(`REDIRECT:${path}`); }, useRouter: () => ({ push: jest.fn() }) }));
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient, Product, User, Category, Brand } from "@prisma/client";
import { GET as indexRoute } from "@/app/sitemap.xml/route";
import { GET as fileRoute } from "@/app/sitemaps/[file]/route";
import robots from "@/app/robots";
import ProductPage, { generateMetadata } from "@/app/(marketing)/products/[slug]/page";
import CategoryPage, { generateMetadata as categoryMetadata } from "@/app/(marketing)/categories/[slug]/page";
import { generateMetadata as listingMetadata } from "@/app/(marketing)/products/page";
import { GET as productApi } from "@/app/api/products/[slug]/route";
import { getPublicProduct } from "@/lib/public-product";
import { SITEMAP_PAGE_SIZE } from "@/lib/seo/sitemaps";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("actual exported SEO routes and public catalog", () => {
  let db: PrismaClient, seller: User, blocked: User, category: Category, brand: Brand;
  const prefix = `audit-seo-${randomUUID()}`, products: Product[] = [], origin = "https://seo.example.invalid";
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma; process.env.APP_URL = origin;
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } }); brand = await db.brand.create({ data: { name: prefix, slug: prefix } });
    for (const suffix of ["live", "stock-zero", "pending", "blocked"]) products.push(await db.product.create({ data: { name: suffix === "live" ? `${prefix}</script><script>alert(1)</script>` : `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`, description: "Stored product description", price: 100, discountPrice: 90, stock: suffix === "stock-zero" ? 0 : 3, status: suffix === "pending" ? "PENDING_APPROVAL" : "APPROVED", sellerId: suffix === "blocked" ? blocked.id : seller.id, categoryId: category.id, brandId: brand.id, imageUrl: "/file.svg" } }));
    await db.product.createMany({ data: Array.from({ length: SITEMAP_PAGE_SIZE + 1 }, (_, index) => ({ name: `${prefix}-bulk-${index}`, slug: `${prefix}-bulk-${index}`, price: 100, stock: 1, status: "APPROVED", sellerId: seller.id, categoryId: category.id })) });
  });
  beforeEach(() => { process.env.APP_URL = origin; });
  afterAll(async () => { if (db) try { await db.product.deleteMany({ where: { slug: { startsWith: prefix } } }); await db.brand.deleteMany({ where: { id: brand.id } }); await db.category.deleteMany({ where: { id: category.id } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); } finally { process.env.APP_URL = "http://localhost"; await db.$disconnect(); } });
  const file = (name: string) => fileRoute(new Request(origin + `/sitemaps/${name}`), { params: Promise.resolve({ file: name }) });
  it("exports a runtime-origin robots/index and bounded visible-product shards without gaps", async () => {
    expect(robots().sitemap).toBe(origin + "/sitemap.xml");
    const index = await indexRoute(); expect(index.status).toBe(200); const xml = await index.text(); expect(xml).toContain(origin + "/sitemaps/products-0.xml"); expect(xml).toContain(origin + "/sitemaps/products-1.xml"); expect(xml).not.toContain("amar-gadget.com");
    const first = await file("products-0.xml"), second = await file("products-1.xml");
    expect(first.headers.get("content-type")).toContain("application/xml"); expect(first.headers.get("cache-control")).toBe("no-store");
    const firstXml = await first.text(), secondXml = await second.text(); expect(firstXml.match(/<url>/g)).toHaveLength(SITEMAP_PAGE_SIZE);
    const ownUrls = [...(firstXml + secondXml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).filter((url) => url.includes(prefix));
    const expected = [...products.slice(0, 2).map((p) => `${origin}/products/${p.slug}`), ...Array.from({ length: SITEMAP_PAGE_SIZE + 1 }, (_, index) => `${origin}/products/${prefix}-bulk-${index}`)];
    expect(ownUrls.sort()).toEqual(expected.sort()); expect(new Set(ownUrls).size).toBe(ownUrls.length);
    const all = firstXml + secondXml; for (const product of products.slice(0, 2)) expect(all).toContain(`/products/${product.slug}`); for (const product of products.slice(2)) expect(all).not.toContain(product.slug);
    expect((await file("products-99999.xml")).status).toBe(404); expect((await file("products-01.xml")).status).toBe(404);
  });
  it("includes real taxonomy destinations and excludes personal/placeholder routes", async () => {
    expect(await (await file("categories-0.xml")).text()).toContain(`/categories/${category.slug}`);
    expect(await (await file("brands-0.xml")).text()).toContain(`/products?brand=${brand.slug}`);
    const pages = await (await file("pages.xml")).text(); for (const path of ["/checkout", "/admin", "/login", "/cart", "/privacy-policy", "/blog"]) expect(pages).not.toContain(`<loc>${origin}${path}</loc>`);
    expect(pages).toContain(`<loc>${origin}/products</loc>`);
  });
  it("renders actual Product JSON-LD with canonical slug, safe text, current price and stock", async () => {
    for (const product of products.slice(0, 2)) {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: product.id }) }); expect(metadata.alternates?.canonical).toBe(`${origin}/products/${product.slug}`);
      await expect(ProductPage({ params: Promise.resolve({ slug: product.id }) })).rejects.toThrow(`REDIRECT:/products/${product.slug}`);
      const html = renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ slug: product.slug }) }));
      const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
      const schema = schemas.find((item) => item["@type"] === "Product"); expect(schema.offers).toMatchObject({ url: `${origin}/products/${product.slug}`, price: 90, priceCurrency: "BDT", availability: `https://schema.org/${product.stock ? "InStock" : "OutOfStock"}` });
      expect(schema.offers).not.toHaveProperty("priceValidUntil"); expect(schema.offers).not.toHaveProperty("itemCondition"); expect(html).not.toContain("<script>alert(1)</script>");
      expect(schema.image).toEqual([origin + "/file.svg"]);
    }
  });
  it("noindexes hidden/missing/private/search flows and preserves API visibility", async () => {
    for (const product of products.slice(2)) { expect(await generateMetadata({ params: Promise.resolve({ slug: product.slug }) })).toMatchObject({ robots: { index: false } }); await expect(ProductPage({ params: Promise.resolve({ slug: product.slug }) })).rejects.toThrow("NOT_FOUND"); expect((await productApi(new Request(origin), { params: Promise.resolve({ slug: product.slug }) })).status).toBe(404); }
    expect(await listingMetadata({ searchParams: Promise.resolve({ search: "gadget" }) })).toMatchObject({ robots: { index: false } });
    const canonical = await listingMetadata({ searchParams: Promise.resolve({ brandId: brand.id }) }); expect(canonical.alternates?.canonical).toBe(`${origin}/products?brand=${brand.slug}`);
  });
  it("uses literal unambiguous aliases and canonical category resolution", async () => {
    expect((await getPublicProduct(products[0].slug.toUpperCase()))?.id).toBe(products[0].id); expect(await getPublicProduct(prefix + "%")).toBeNull();
    expect((await categoryMetadata({ params: Promise.resolve({ slug: category.slug.toUpperCase() }) })).alternates?.canonical).toBe(`${origin}/categories/${category.slug}`);
    await expect(CategoryPage({ params: Promise.resolve({ slug: category.id }) })).rejects.toThrow(`REDIRECT:/categories/${category.slug}`);
  });
  it("returns safe 503 and noindex metadata on data outage instead of a successful empty sitemap or fake 404", async () => {
    const transaction = jest.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("private database details"));
    try { const response = await indexRoute(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private database"); } finally { transaction.mockRestore(); }
    const query = jest.spyOn(db.product, "findFirst").mockRejectedValue(new Error("private database details"));
    try { expect(await generateMetadata({ params: Promise.resolve({ slug: products[0].slug }) })).toMatchObject({ robots: { index: false } }); expect((await productApi(new Request(origin), { params: Promise.resolve({ slug: products[0].slug }) })).status).toBe(503); } finally { query.mockRestore(); }
  });
  it("keeps legacy unusable slugs on working ID destinations without redirect loops", async () => {
    await db.product.update({ where: { id: products[0].id }, data: { slug: "." } });
    await db.category.update({ where: { id: category.id }, data: { slug: " " } });
    try {
      expect((await generateMetadata({ params: Promise.resolve({ slug: products[0].id }) })).alternates?.canonical).toBe(`${origin}/products/${products[0].id}`);
      const html = renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ slug: products[0].id }) })); expect(html).toContain(`${origin}/products/${products[0].id}`);
      expect((await categoryMetadata({ params: Promise.resolve({ slug: category.id }) })).alternates?.canonical).toBe(`${origin}/categories/${category.id}`);
      expect((await listingMetadata({ searchParams: Promise.resolve({ categoryId: category.id }) })).alternates?.canonical).toBe(`${origin}/categories/${category.id}`);
      expect(await (await file("categories-0.xml")).text()).toContain(`/categories/${category.id}`);
    } finally { await db.product.update({ where: { id: products[0].id }, data: { slug: products[0].slug } }); await db.category.update({ where: { id: category.id }, data: { slug: category.slug } }); }
  });
});
