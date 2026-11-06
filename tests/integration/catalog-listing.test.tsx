jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(), getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn(() => "192.0.2.1"), rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import type { PrismaClient, User, Brand, Category, Product } from "@prisma/client";
import { getCatalogListing } from "@/lib/catalog-listing";
import { getCatalogOptions } from "@/lib/catalog-options";
import { GET } from "@/app/api/products/route";
import { GET as optionsApi } from "@/app/api/catalog/options/route";
import { getProducts } from "@/server/actions/product/product-actions";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import ProductsPage from "@/app/(marketing)/products/page";
import { catalogHref, catalogQuerySchema } from "@/lib/validations/catalog-query";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("shared bounded catalog filtering, ranking, pages and options", () => {
  let db: PrismaClient, seller: User, blocked: User, buyer: User, admin: User, brand: Brand, other: Brand, category: Category, secondCategory: Category;
  const products: Product[] = [], orderIds: string[] = [];
  let pending: Product, otherPending: Product;
  const prefix = `audit-listing-${randomUUID()}`;
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    buyer = await db.user.create({ data: { email: `${prefix}-buyer@example.invalid`, isVerified: true } });
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: "ADMIN", isVerified: true } });
    brand = await db.brand.create({ data: { name: `${prefix}-brand`, slug: `${prefix}-brand` } });
    other = await db.brand.create({ data: { name: `${prefix}-other`, slug: `${prefix}-other` } });
    category = await db.category.create({ data: { name: `${prefix}-phones`, slug: `${prefix}-phones` } });
    secondCategory = await db.category.create({ data: { name: `${prefix}-audio`, slug: `${prefix}-audio` } });
    for (let index = 0; index < 30; index++) products.push(await db.product.create({ data: { name: `${prefix}-${index === 0 ? "100%_gadget" : `item-${String(index).padStart(2, "0")}`}`, slug: `${prefix}-${index}`, price: 100 + index, discountPrice: index < 2 ? 50 + index * 10 : null, stock: 5, rating: index % 5, reviewCount: index, sellerId: seller.id, categoryId: index < 20 ? category.id : secondCategory.id, brandId: index < 25 ? brand.id : other.id, status: "APPROVED", createdAt: new Date("2026-01-01T00:00:00Z") } }));
    pending = await db.product.create({ data: { name: `${prefix}-pending`, slug: `${prefix}-pending`, price: 1, stock: 1, sellerId: seller.id, categoryId: category.id } });
    otherPending = await db.product.create({ data: { name: `${prefix}-other-pending`, slug: `${prefix}-other-pending`, price: 1, stock: 1, sellerId: blocked.id, categoryId: category.id } });
    const hidden = await db.product.create({ data: { name: `${prefix}-blocked-product`, slug: `${prefix}-blocked-product`, price: 1, stock: 1, sellerId: blocked.id, categoryId: category.id, status: "APPROVED" } });
    for (const [product, quantity, status, paymentStatus] of [[products[5], 7, "DELIVERED", "PAID"], [products[5], 2, "DELIVERED", "PAID"], [products[20], 4, "DELIVERED", "PAID"], [products[0], 999, "DELIVERED", "UNPAID"], [products[1], 999, "CANCELLED", "PAID"], [products[2], 999, "PROCESSING", "PAID"], [pending, 999, "DELIVERED", "PAID"], [hidden, 999, "DELIVERED", "PAID"]] as const) {
      const order = await db.order.create({ data: { userId: buyer.id, total: 100, status, paymentStatus, items: { create: { productId: product.id, quantity, price: 1 } } } }); orderIds.push(order.id);
    }
    for (const kind of ["brand", "category"] as const) {
      const data = Array.from({ length: 28 }, (_, index) => ({ name: `${prefix}-choice-${String(index).padStart(2, "0")}`, slug: `${prefix}-choice-${index}` }));
      if (kind === "brand") await db.brand.createMany({ data }); else await db.category.createMany({ data });
    }
  }, 30_000);
  beforeEach(() => { (getCurrentUser as jest.Mock).mockResolvedValue(null); });
  afterAll(async () => { if (db) try { await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }); await db.order.deleteMany({ where: { id: { in: orderIds } } }); await db.product.deleteMany({ where: { name: { startsWith: prefix } } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); await db.brand.deleteMany({ where: { slug: { startsWith: prefix } } }); await db.category.deleteMany({ where: { slug: { startsWith: prefix } } }); } finally { await db.$disconnect(); } });
  const api = async (query: Record<string, string>) => { const response = await GET(new NextRequest(`http://localhost/api/products?${new URLSearchParams(query)}`)); return { status: response.status, body: await response.json() }; };

  it("returns bounded deterministic pages and exact totals across API and action", async () => {
    const first = await api({ search: prefix, limit: "7" }); const second = await api({ search: prefix, limit: "7", page: "2" });
    expect(first.body.total).toBe(30); expect(first.body.totalPages).toBe(5); expect(first.body.products).toHaveLength(7);
    expect(second.body.products).toHaveLength(7); expect(first.body.products.some((item: Product) => second.body.products.some((entry: Product) => entry.id === item.id))).toBe(false);
    const expected = products.map((item) => item.id).sort();
    expect([...first.body.products, ...second.body.products].map((item: Product) => item.id)).toEqual(expected.slice(0, 14));
    const action = await getProducts({ search: prefix, limit: 7, page: 2 }); expect(action.data.map((item) => item.id)).toEqual(second.body.products.map((item: Product) => item.id));
  });
  it("filters and sorts by the same effective price rather than the undiscounted price", async () => {
    const low = await getCatalogListing({ search: prefix, sort: "price_low", limit: 48 });
    expect(low.products.map((item) => item.id)).toEqual(products.map((item) => item.id));
    const high = await getCatalogListing({ search: prefix, sort: "price_high", limit: 48 }); expect(high.products.map((item) => item.id)).toEqual([...products].reverse().map((item) => item.id));
    const range = await api({ search: prefix, minPrice: "55", maxPrice: "110", sort: "price_low" });
    expect(range.body.products.map((item: Product) => item.id)).toEqual(products.slice(1, 11).map((item) => item.id));
    expect(range.body.products[0].effectivePrice).toBe(60);
  });
  it("intersects category, brand, text, sale and price constraints consistently", async () => {
    const query = { q: prefix, category: category.slug, brand: brand.slug, filter: "sale", minPrice: "55", maxPrice: "110", sort: "price_low" };
    const response = await api(query); expect(response.body.products.map((item: Product) => item.id)).toEqual([products[1].id]);
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve(query) }));
    expect(html).toContain(products[1].name); expect(html).not.toContain(products[0].name); expect(html).toContain("Showing 1–1 of 1 products");
    expect(html).toContain('aria-label="Product filters"'); expect(html).toContain('name="minPrice"');
  });
  it("ranks actual paid delivered units and excludes unpaid, cancelled, unfulfilled and hidden sales", async () => {
    const response = await api({ search: prefix, sort: "bestsellers", limit: "48" });
    expect(response.body.products[0]).toMatchObject({ id: products[5].id, unitsSold: "9" });
    expect(response.body.products[1]).toMatchObject({ id: products[20].id, unitsSold: "4" });
    expect(response.body.products.slice(2).every((item: { unitsSold: string }) => item.unitsSold === "0")).toBe(true);
    expect(response.body.total).toBe(30);
  });
  it("orders ratings with stable review-count/date/ID ties", async () => {
    const ranked = await getCatalogListing({ search: prefix, sort: "rating", limit: 48 });
    expect(ranked.products.map((item) => item.id)).toEqual([...products].sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount || a.id.localeCompare(b.id)).map((item) => item.id));
  });
  it("returns explicit out-of-range and unknown-category states without deep-offset data reads", async () => {
    const response = await api({ search: prefix, page: "1000000" }); expect(response.body.products).toEqual([]); expect(response.body.total).toBe(30); expect(response.body.outOfRange).toBe(true);
    const missing = await api({ category: `${prefix}-absent` }); expect(missing.body.total).toBe(0); expect(missing.body.categoryFilter.state).toBe("missing");
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ search: prefix, page: "1000000" }) })); expect(html).toContain("Return to the first results page");
  });
  it("treats search wildcards and injection-looking input as literal text", async () => {
    const literal = await api({ search: "%_" }); expect(literal.body.products.map((item: Product) => item.id)).toEqual([products[0].id]);
    expect((await api({ search: `${prefix}' OR 1=1 --` })).body.total).toBe(0);
  });
  it("rejects malformed ranges, repeated fields, unknown sorts, unsafe sizes and private public-API selectors", async () => {
    const invalid: Record<string, string>[] = [{ minPrice: "10", maxPrice: "1" }, { page: "-1" }, { page: "1.5" }, { page: "1000001" }, { limit: "49" }, { sort: "unknown" }, { minPrice: "Infinity" }, { minPrice: "1.001" }, { search: "a", q: "b" }, { status: "PENDING_APPROVAL" }];
    for (const query of invalid) expect((await api(query)).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/products?sort=latest&sort=rating"))).status).toBe(400);
  });
  it("retains private-status ownership and checks current account versions", async () => {
    expect((await getProducts({ status: "PENDING_APPROVAL", search: prefix })).success).toBe(false);
    (getCurrentUser as jest.Mock).mockResolvedValue(seller);
    expect((await getProducts({ status: "PENDING_APPROVAL", search: prefix })).data.map((item) => item.id)).toEqual([pending.id]);
    (getCurrentUser as jest.Mock).mockResolvedValue(admin);
    expect((await getProducts({ status: "PENDING_APPROVAL", search: prefix })).data.map((item) => item.id).sort()).toEqual([pending.id, otherPending.id].sort());
    await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await getProducts({ status: "PENDING_APPROVAL", search: prefix })).success).toBe(false);
    admin = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
  });
  it("browses every option through bounded pages, with literal search and API input/rate denial", async () => {
    for (const kind of ["brand", "category"] as const) {
      const first = await getCatalogOptions(kind, `${prefix}-choice`, 1); const next = await getCatalogOptions(kind, `${prefix}-choice`, 2);
      expect(first.total).toBe(28); expect(first.items).toHaveLength(25); expect(next.items).toHaveLength(3); expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(28);
      const response = await optionsApi(new Request(`http://localhost/api/catalog/options?kind=${kind}&search=${prefix}-choice&page=2`)); expect(response.status).toBe(200); expect((await response.json()).items).toHaveLength(3);
    }
    expect((await optionsApi(new Request("http://localhost/api/catalog/options?kind=user"))).status).toBe(400);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false });
    expect((await optionsApi(new Request("http://localhost/api/catalog/options?kind=brand"))).status).toBe(429);
  });
  it("builds filter-preserving pagination links and resets page on filter submission", async () => {
    const query = catalogQuerySchema.parse({ search: prefix, categoryId: category.id, brandId: brand.id, minPrice: "55", maxPrice: "120", filter: "sale", sort: "price_low", limit: 7, page: 2 });
    const params = new URL(catalogHref(query, { page: 3 }), "http://localhost").searchParams;
    expect(params.get("page")).toBe("3"); expect(params.get("minPrice")).toBe("55"); expect(params.get("brandId")).toBe(brand.id); expect(params.get("sort")).toBe("price_low");
    expect(new URL(catalogHref(query, { page: 1 }), "http://localhost").searchParams.has("page")).toBe(false);
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve(Object.fromEntries(new URL(catalogHref(query), "http://localhost").searchParams)) }));
    const form = html.match(/<form[^>]*aria-label="Product filters"[^>]*>([\s\S]*?)<\/form>/)?.[1];
    expect(form).toBeDefined(); expect(form).not.toContain('name="page"');
  });
});
