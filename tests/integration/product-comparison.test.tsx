jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient, Product, User } from "@prisma/client";
import { getCurrentUserWithRole } from "@/lib/session";
import { getProductComparison } from "@/lib/product-comparison";
import ComparePage from "@/app/(marketing)/compare/page";
import SearchPage from "@/app/(marketing)/search/page";
import ProductsPage from "@/app/(marketing)/products/page";
import { adminUpdateSpecifications } from "@/server/actions/product/specification-actions";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("actual comparison SQL, spec mutations, rendering and unified search", () => {
  let db: PrismaClient, seller: User, admin: User, blocked: User;
  const prefix = `audit-compare-${randomUUID()}`, products: Product[] = [];
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", isVerified: true } });
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: "ADMIN", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    const category = await db.category.create({ data: { name: prefix, slug: prefix } });
    for (let index = 0; index < 4; index++) products.push(await db.product.create({ data: { name: `${prefix}-${index}`, slug: `${prefix}-${index}`, price: 100 + index, discountPrice: index ? null : 90, stock: index, sellerId: index === 3 ? blocked.id : seller.id, categoryId: category.id, status: index === 2 ? "PENDING_APPROVAL" : "APPROVED", specifications: index ? [{ label: "screen", value: "LCD" }, { label: "Memory", value: "16 GB" }] : [{ label: "Screen", value: "OLED" }, { label: "Literal", value: "<script>alert(1)</script>" }] } }));
  });
  beforeEach(() => { (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); });
  afterAll(async () => { if (db) try { await db.product.deleteMany({ where: { slug: { startsWith: prefix } } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); await db.category.deleteMany({ where: { slug: prefix } }); } finally { await db.$disconnect(); } });
  it("preserves selection order, refreshes prices and omits pending/blocked products", async () => {
    const result = await getProductComparison([products[1].id, products[0].id, products[2].id, products[3].id]);
    expect(result.products.map((item) => item.id)).toEqual([products[1].id, products[0].id]);
    expect(result.products[1].discountPrice).toBe(90); expect(result.missing).toEqual([products[2].id, products[3].id]);
    await db.product.update({ where: { id: products[0].id }, data: { discountPrice: 80 } });
    expect((await getProductComparison([products[0].id])).products[0].discountPrice).toBe(80);
  });
  it("renders real aligned specs, missing cells and safe plain text with removal links", async () => {
    const html = renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve({ product: products.map((item) => item.id) }) }));
    expect(html).toContain("OLED"); expect(html).toContain("LCD"); expect(html).toContain("16 GB"); expect(html).toContain("Not supplied");
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain(products[2].name); expect(html).not.toContain(products[3].name); expect(html).toContain("2 selected products are unavailable");
    expect(html).toContain('scope="row"'); expect(html).toContain("Remove product 4");
  });
  it("handles empty/one/invalid selections explicitly", async () => {
    expect(renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve({}) }))).toContain("No available products selected");
    expect(renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve({ product: products[0].id }) }))).toContain("Select another product");
    expect(renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve({ product: [products[0].id, products[0].id] }) }))).toContain("four distinct");
  });
  it("writes real admin specs and denies invalid, unauthorized and stale-account mutations", async () => {
    const input = { productId: products[1].id, specifications: [{ label: "Storage", value: "512 GB" }] };
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await adminUpdateSpecifications(input)).success).toBe(false);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    expect((await adminUpdateSpecifications({ ...input, specifications: [{ label: "Storage", value: "" }] })).success).toBe(false);
    expect((await adminUpdateSpecifications(input)).success).toBe(true);
    expect((await getProductComparison([products[1].id])).products[0].specifications).toEqual(input.specifications);
    await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await adminUpdateSpecifications({ ...input, specifications: [] })).success).toBe(false);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[1].id } })).specifications).toEqual(input.specifications);
  });
  it("enforces spec shape/length/duplicates on direct database writes", async () => {
    for (const value of [{}, null, [{ label: "a", value: "" }], [{ label: "a", value: "b" }, { label: " A ", value: "c" }], Array(31).fill({ label: "a", value: "b" })]) {
      await expect(db.$executeRaw`UPDATE "Product" SET specifications = ${JSON.stringify(value)}::jsonb WHERE id = ${products[0].id}`).rejects.toBeDefined();
    }
  });
  it("canonicalizes advertised q searches with intersecting filters to the shared listing", async () => {
    await expect(SearchPage({ searchParams: Promise.resolve({ q: "OLED gadget", minPrice: "10", page: "2" }) })).rejects.toThrow("REDIRECT:/products?search=OLED+gadget&minPrice=10&page=2");
    const page = await SearchPage({ searchParams: Promise.resolve({ q: ["one", "two"] }) });
    expect(page.type).toBe(ProductsPage);
    const invalid = renderToStaticMarkup(await ProductsPage(page.props));
    expect(invalid).toContain("Invalid product filters");
  });
});
