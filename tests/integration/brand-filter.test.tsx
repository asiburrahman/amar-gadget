jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn().mockResolvedValue(null), getCurrentUserWithRole: jest.fn().mockResolvedValue(null) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import type { PrismaClient, User, Brand, Category, Product } from "@prisma/client";
import { resolveCatalogBrand } from "@/lib/catalog-brand-filter";
import { GET } from "@/app/api/products/route";
import ProductsPage, { generateMetadata } from "@/app/(marketing)/products/page";
import BrandsPage from "@/app/(marketing)/brands/page";
import { getProducts } from "@/server/actions/product/product-actions";
import { withoutBrandFilter } from "@/lib/validations/catalog-brand";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("canonical brand filtering across actual SQL, API, action and rendered pages", () => {
  let db: PrismaClient, seller: User, blocked: User, brand: Brand, other: Brand, category: Category, secondCategory: Category;
  let visible: Product, secondVisible: Product;
  const prefix = `audit-brand-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Use an isolated local audit_* database");
    process.env.DATABASE_URL = url.toString(); db = (await import("@/lib/prisma")).prisma;
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    brand = await db.brand.create({ data: { name: `000-${prefix} Apple`, slug: `${prefix}-apple` } });
    other = await db.brand.create({ data: { name: `000-${prefix} Pineapple`, slug: `${prefix}-pineapple` } });
    category = await db.category.create({ data: { name: `${prefix}-phones`, slug: `${prefix}-phones` } });
    secondCategory = await db.category.create({ data: { name: `${prefix}-audio`, slug: `${prefix}-audio` } });
    const create = (suffix: string, extra = {}) => db.product.create({ data: { name: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`, price: 100, stock: 2, sellerId: seller.id, categoryId: category.id, brandId: brand.id, status: "APPROVED", ...extra } });
    visible = await create("apple-phone", { discountPrice: 90 });
    secondVisible = await create("apple-audio", { categoryId: secondCategory.id });
    await create("pineapple-phone", { brandId: other.id }); await create("no-brand", { brandId: null });
    await create("apple-pending", { status: "PENDING_APPROVAL" }); await create("apple-blocked", { sellerId: blocked.id });
  });
  afterAll(async () => {
    if (db) try { await db.product.deleteMany({ where: { name: { startsWith: prefix } } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); await db.brand.deleteMany({ where: { slug: { startsWith: prefix } } }); await db.category.deleteMany({ where: { slug: { startsWith: prefix } } }); } finally { await db.$disconnect(); }
  });
  const api = async (query: Record<string, string | undefined>) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value); const response = await GET(new NextRequest(`http://localhost/api/products?${params}`)); return { status: response.status, body: await response.json() }; };
  it("resolves stored slugs, explicit IDs and case aliases without fuzzy brand-name matching", async () => {
    for (const [value, id] of [[brand.slug, undefined], [brand.slug.toUpperCase(), undefined], [brand.id, undefined], [undefined, brand.id], [brand.slug, brand.id]]) expect(await resolveCatalogBrand(value, id)).toEqual({ state: "found", brand: { id: brand.id, name: brand.name, slug: brand.slug } });
    expect(await resolveCatalogBrand(undefined, undefined)).toEqual({ state: "none" });
    expect(await resolveCatalogBrand(brand.slug.slice(0, -2), undefined)).toEqual({ state: "missing" });
    expect((await api({ brand: "", search: prefix })).body.products).toHaveLength(4);
  });
  it("returns only the selected brand's approved products from approved sellers in both API and action", async () => {
    for (const query of [{ brand: brand.slug }, { brandId: brand.id }, { brand: brand.slug.toUpperCase() }]) {
      const response = await api({ ...query, search: prefix });
      expect(response.status).toBe(200); expect(response.body.total).toBe(2);
      expect(response.body.products.map((item: Product) => item.id).sort()).toEqual([visible.id, secondVisible.id].sort());
      expect(response.body.brandFilter.brand.slug).toBe(brand.slug);
      const action = await getProducts({ ...query, search: prefix });
      expect(action.success).toBe(true); expect(action.total).toBe(2);
      expect(action.data.map((item) => item.id).sort()).toEqual([visible.id, secondVisible.id].sort());
    }
  });
  it("treats SQL wildcard characters literally and refuses ambiguous case-folded aliases", async () => {
    for (const value of [`${brand.slug}%`, brand.slug.slice(0, -1) + "_", `${brand.slug}\\`]) expect(await resolveCatalogBrand(value, undefined)).toEqual({ state: "missing" });
    const literal = await db.brand.create({ data: { name: `000-${prefix} Literal`, slug: `${prefix}-literal_%` } });
    expect(await resolveCatalogBrand(literal.slug.toUpperCase(), undefined)).toMatchObject({ state: "found", brand: { id: literal.id } });
    await db.brand.create({ data: { name: `000-${prefix} Mixed one`, slug: `${prefix}-Mixed` } });
    await db.brand.create({ data: { name: `000-${prefix} Mixed two`, slug: `${prefix}-mIXED` } });
    expect(await resolveCatalogBrand(`${prefix.toUpperCase()}-MIXED`, undefined)).toMatchObject({ state: "invalid" });
  });
  it("intersects brand, category and search instead of replacing existing predicates", async () => {
    const response = await api({ brand: brand.slug, categoryId: category.id, search: prefix });
    expect(response.body.products.map((item: Product) => item.id)).toEqual([visible.id]);
    const action = await getProducts({ brand: brand.slug, categoryId: secondCategory.id, search: prefix });
    expect(action.data.map((item) => item.id)).toEqual([secondVisible.id]);
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ brand: brand.slug, categoryId: category.id, search: prefix, filter: "sale" }) }));
    expect(html).toContain(visible.name); expect(html).not.toContain(secondVisible.name); expect(html).not.toContain(`${prefix}-pineapple-phone`);
  });
  it("renders a named brand collection and brand-aware metadata with only its selected products", async () => {
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ brandId: brand.id, search: prefix }) }));
    expect(html).toContain(`${brand.name} Collection`); expect(html).toContain(visible.name); expect(html).toContain(secondVisible.name);
    for (const suffix of ["pineapple-phone", "no-brand", "apple-pending", "apple-blocked"]) expect(html).not.toContain(`${prefix}-${suffix}`);
    expect((await generateMetadata({ searchParams: Promise.resolve({ brand: brand.slug }) })).title).toBe(`${brand.name} Collection | Amar Gadget`);
  });
  it("returns explicit empty/not-found states for missing brand references and never broadens the catalog", async () => {
    const missing = `${prefix}-missing`;
    const response = await api({ brand: missing, search: prefix });
    expect(response.status).toBe(200); expect(response.body.products).toEqual([]); expect(response.body.brandFilter.state).toBe("missing");
    expect((await getProducts({ brand: missing })).data).toEqual([]);
    expect(await getProducts({ brand: missing, status: "PENDING_APPROVAL" })).toMatchObject({ success: false, error: "Unauthorized" });
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ brand: missing }) }));
    expect(html).toContain("Brand not found"); expect(html).not.toContain(visible.name); expect(html).toContain("Clear brand filter");
    expect((await generateMetadata({ searchParams: Promise.resolve({ brand: missing }) })).robots).toEqual({ index: false, follow: true });
    expect((await api({ brandId: randomUUID(), search: prefix })).body.products).toEqual([]);
    const empty = await db.brand.create({ data: { name: `000-${prefix} Empty`, slug: `${prefix}-empty` } });
    const validEmpty = await api({ brandId: empty.id });
    expect(validEmpty.body.brandFilter.state).toBe("found"); expect(validEmpty.body.products).toEqual([]);
  });
  it("rejects conflicting, repeated or unbounded brand parameters rather than selecting a different brand", async () => {
    expect((await api({ brand: brand.slug, brandId: other.id })).status).toBe(400);
    expect((await api({ brand: "x".repeat(121) })).status).toBe(400);
    expect((await GET(new NextRequest(`http://localhost/api/products?brand=${brand.slug}&brand=${other.slug}`))).status).toBe(400);
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ brand: [brand.slug, other.slug] }) }));
    expect(html).toContain("Invalid brand filter"); expect(html).not.toContain(visible.name);
    expect((await getProducts({ brand: brand.slug, brandId: other.id })).success).toBe(false);
  });
  it("renders real canonical directory links/counts and preserves other filters when clearing a brand", async () => {
    const legacy = await db.brand.create({ data: { name: `000-${prefix} Long slug`, slug: `${prefix}-${"x".repeat(121)}` } });
    const html = renderToStaticMarkup(await BrandsPage({}));
    expect(html).toContain(`/products?brand=${brand.slug}`); expect(html).toContain(brand.name);
    expect(html).toContain(`/products?brandId=${legacy.id}`);
    expect((await api({ brandId: legacy.id })).body.brandFilter.state).toBe("found");
    const card = html.match(new RegExp(`<a[^>]*href="/products\\?brand=${brand.slug}"[^>]*>([\\s\\S]*?)</a>`))?.[1];
    expect(card).toContain("2 products"); expect(html).not.toContain("120+ Products"); expect(html).not.toContain("Official Partner");
    const href = withoutBrandFilter({ brand: brand.slug, brandId: brand.id, categoryId: category.id, search: "phone & audio", filter: "sale", sort: "price_low", page: "5" });
    const params = new URL(href, "http://localhost").searchParams;
    expect(params.get("categoryId")).toBe(category.id); expect(params.get("search")).toBe("phone & audio"); expect(params.get("filter")).toBe("sale"); expect(params.get("sort")).toBe("price_low");
    expect(params.has("brand")).toBe(false); expect(params.has("brandId")).toBe(false); expect(params.has("page")).toBe(false);
  });
  it("distinguishes lookup failures from a missing brand without exposing provider details", async () => {
    const lookup = jest.spyOn(db.brand, "findUnique");
    try {
      lookup.mockRejectedValueOnce(new Error("private-connection-detail"));
      const failed = await api({ brand: brand.slug });
      expect(failed.status).toBe(503); expect(failed.body.success).toBe(false); expect(JSON.stringify(failed.body)).not.toContain("private-connection-detail");
      lookup.mockRejectedValueOnce(new Error("private-connection-detail"));
      const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ brand: brand.slug }) }));
      expect(html).toContain("Products are temporarily unavailable"); expect(html).not.toContain("Brand not found");
    } finally { lookup.mockRestore(); }
  });
});
