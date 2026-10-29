jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { randomUUID } from "node:crypto";
import type { PrismaClient, User, Product, Category } from "@prisma/client";
import { getCurrentUserWithRole } from "@/lib/session";
import { updateProductStatus, adminUpdateProductPrice, adminDeleteProduct, updateSellerStatus } from "@/server/actions/admin/admin-actions";
import { POST } from "@/app/api/admin/sellers/route";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("catalog mutations use runtime validation and current PostgreSQL authority", () => {
  let db: PrismaClient, admin: User, seller: User, customer: User, product: Product, category: Category, actor: User | null;
  const prefix = `audit-catalog-${randomUUID()}`;
  const image = "https://media.example.invalid/real-product.png";
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Use an isolated local audit_* database");
    process.env.DATABASE_URL = url.toString(); db = (await import("@/lib/prisma")).prisma;
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: "ADMIN", isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    customer = await db.user.create({ data: { email: `${prefix}-customer@example.invalid`, role: "USER", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    product = await db.product.create({ data: { name: prefix, slug: prefix, price: 100, stock: 1, sellerId: seller.id, categoryId: category.id, imageUrl: image, images: [image] } });
    (getCurrentUserWithRole as jest.Mock).mockImplementation(async (roles: string[]) => actor && roles.includes(actor.role.toUpperCase()) ? actor : null);
  });
  beforeEach(async () => { actor = admin; await db.product.update({ where: { id: product.id }, data: { price: 100, discountPrice: null, status: "PENDING_APPROVAL", imageUrl: image, images: [image] } }); });
  afterAll(async () => {
    if (db) try { await db.wishlist.deleteMany({ where: { userId: customer?.id } }); if (seller) await db.product.deleteMany({ where: { sellerId: seller.id } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); if (category) await db.category.delete({ where: { id: category.id } }); } finally { await db.$disconnect(); }
  });
  it("denies anonymous, customer and seller mutations without changing records", async () => {
    for (const viewer of [null, customer, seller]) {
      actor = viewer;
      for (const result of [await updateProductStatus(product.id, "APPROVED"), await adminUpdateProductPrice(product.id, 50), await adminDeleteProduct(product.id), await updateSellerStatus(seller.id, "BLOCKED")]) expect(result).toMatchObject({ success: false, error: "Unauthorized" });
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).price.toString()).toBe("100");
    expect((await db.user.findUniqueOrThrow({ where: { id: seller.id } })).sellerStatus).toBe("APPROVED");
  });
  it("rejects malformed direct-action values and preserves the complete product", async () => {
    const before = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    for (const price of [NaN, Infinity, -1, 0, 1.001, 100_000_000, "50", {}, null]) expect((await adminUpdateProductPrice(product.id, price)).success).toBe(false);
    for (const discount of [0, 100, 101, 1.001, "50", NaN, Infinity]) expect((await adminUpdateProductPrice(product.id, 100, discount)).success).toBe(false);
    for (const status of ["PAID", "approved", {}, null, ["APPROVED"]]) expect((await updateProductStatus(product.id, status)).success).toBe(false);
    for (const id of [null, {}, [], "", "x".repeat(65)]) { expect((await adminDeleteProduct(id)).success).toBe(false); expect((await adminUpdateProductPrice(id, 1)).success).toBe(false); }
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(before);
  });
  it("writes exact prices, clears discounts and returns serializable values", async () => {
    const result = await adminUpdateProductPrice(product.id, 1234.56, 999.99);
    expect(result).toMatchObject({ success: true, data: { price: 1234.56, discountPrice: 999.99 } });
    const saved = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.price.toString()).toBe("1234.56"); expect(saved.discountPrice?.toString()).toBe("999.99");
    expect((await adminUpdateProductPrice(product.id, 1234.56, null)).success).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).discountPrice).toBeNull();
    expect((await adminUpdateProductPrice(product.id, 99_999_999.99)).success).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).price.toString()).toBe("99999999.99");
  });
  it("approves valid records, quarantines rejected records and refuses invalid legacy approval", async () => {
    expect((await updateProductStatus(product.id, "APPROVED")).success).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("APPROVED");
    expect((await updateProductStatus(product.id, "REJECTED")).success).toBe(true);
    await db.product.update({ where: { id: product.id }, data: { discountPrice: 150, imageUrl: "javascript:alert(1)" } });
    expect((await updateProductStatus(product.id, "APPROVED")).success).toBe(false);
    expect((await updateProductStatus(product.id, "PENDING_APPROVAL")).success).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("PENDING_APPROVAL");
  });
  it("does not approve a suspended seller's listing", async () => {
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } });
    try { expect((await updateProductStatus(product.id, "APPROVED")).success).toBe(false); }
    finally { seller = await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } }); }
  });
  it("requires local image references to resolve to actual public assets", async () => {
    await db.product.update({ where: { id: product.id }, data: { imageUrl: "/images/missing-product.png", images: ["/images/missing-product.png"] } });
    expect((await updateProductStatus(product.id, "APPROVED")).success).toBe(false);
    await db.product.update({ where: { id: product.id }, data: { imageUrl: "/file.svg", images: ["/file.svg"] } });
    expect((await updateProductStatus(product.id, "APPROVED")).success).toBe(true);
  });
  it("refuses a stale administrator version and a concurrent role demotion", async () => {
    for (const change of [{ sessionVersion: { increment: 1 } }, { role: "USER" }]) {
      await db.user.update({ where: { id: admin.id }, data: change });
      try { expect((await adminUpdateProductPrice(product.id, 10)).success).toBe(false); expect((await updateProductStatus(product.id, "APPROVED")).success).toBe(false); }
      finally { admin = await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } }); actor = admin; }
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).price.toString()).toBe("100");
  });
  it("guards seller statuses through both entry points and rejects malformed JSON/body size", async () => {
    expect((await updateSellerStatus(seller.id, "ADMIN")).success).toBe(false);
    expect((await updateSellerStatus(customer.id, "APPROVED")).success).toBe(false);
    const request = (body: string) => new Request("http://localhost/api/admin/sellers", { method: "POST", body });
    for (const body of ["{", JSON.stringify({ sellerId: seller.id, sellerStatus: "ADMIN" }), JSON.stringify({ sellerId: seller.id, sellerStatus: "BLOCKED", role: "ADMIN" })]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request("x".repeat(2049)))).status).toBe(413);
    const response = await POST(request(JSON.stringify({ sellerId: seller.id, sellerStatus: "BLOCKED" })));
    expect(response.status).toBe(200); expect((await response.json()).user.sellerStatus).toBe("BLOCKED");
    seller = await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } });
    (getCurrentUserWithRole as jest.Mock).mockRejectedValueOnce(new Error("private-provider-detail"));
    const unavailable = await POST(request(JSON.stringify({ sellerId: seller.id, sellerStatus: "BLOCKED" })));
    expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("private-provider-detail");
  });
  it("reports missing records and preserves foreign-key protected product history", async () => {
    expect((await adminUpdateProductPrice(randomUUID(), 10)).success).toBe(false);
    expect((await updateProductStatus(randomUUID(), "APPROVED")).success).toBe(false);
    expect((await adminDeleteProduct(randomUUID())).success).toBe(false);
    await db.wishlist.create({ data: { userId: customer.id, productId: product.id } });
    expect(await adminDeleteProduct(product.id)).toMatchObject({ success: false, error: expect.stringContaining("referenced") });
    expect(await db.wishlist.count({ where: { productId: product.id } })).toBe(1);
    await db.wishlist.deleteMany({ where: { productId: product.id } });
    const spare = await db.product.create({ data: { name: prefix, slug: `${prefix}-spare`, price: 1, stock: 0, sellerId: seller.id, categoryId: category.id } });
    expect((await adminDeleteProduct(spare.id)).success).toBe(true); expect(await db.product.findUnique({ where: { id: spare.id } })).toBeNull();
  });
});
