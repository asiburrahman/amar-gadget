import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readSellerDashboardCatalog } from "@/lib/seller-dashboard-catalog";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { ServiceUnavailableError } from "@/lib/observability";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("bounded approved seller dashboard catalog", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, seller: User, other: User;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [seller, other] = await Promise.all([0, 1].map(() => mockDatabase.user.create({ data: { email: `${randomUUID()}@seller-read.example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "APPROVED" } })));
    const category = await mockDatabase.category.create({ data: { name: "Seller category", slug: randomUUID() } });
    await mockDatabase.product.createMany({ data: Array.from({ length: 24 }, (_, index) => ({ name: index === 23 ? "Battery 50%_safe" : `Seller gadget ${index}`, slug: randomUUID(), sellerId: seller.id, categoryId: category.id, price: 100, stock: 5, status: index < 21 ? "APPROVED" : "PENDING_APPROVAL" })) });
    await mockDatabase.product.create({ data: { name: "Private other seller product", slug: randomUUID(), sellerId: other.id, categoryId: category.id, price: 100, stock: 5, status: "APPROVED" } });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it("covers the complete own catalog in stable pages and computes counts independently of loaded rows", async () => {
    const first = await readSellerDashboardCatalog(seller, {}), next = await readSellerDashboardCatalog(seller, { page: 2 });
    expect(first).toMatchObject({ total: 24, totalPages: 2, pageSize: 20, counts: { ALL: 24, APPROVED: 21, PENDING: 3 } });
    expect(first.products).toHaveLength(20); expect(next.products).toHaveLength(4);
    expect(new Set([...first.products, ...next.products].map((row) => row.id)).size).toBe(24);
    expect(first.products[0].category.name).toBe("Seller category");
    expect(first.products[0]).toHaveProperty("stock", 5); expect(first.seller.id).toBe(seller.id);
    expect((await readSellerDashboardCatalog(other, {})).total).toBe(1);
  });
  it("applies full-scope filters and literal search while preserving all-time card counts", async () => {
    expect((await readSellerDashboardCatalog(seller, { status: "APPROVED", page: 2 })).products).toHaveLength(1);
    const pending = await readSellerDashboardCatalog(seller, { status: "PENDING" }); expect(pending.total).toBe(3); expect(pending.products.every((row) => row.status === "PENDING_APPROVAL")).toBe(true);
    const literal = await readSellerDashboardCatalog(seller, { q: "%_" }); expect(literal.total).toBe(1); expect(literal.counts.ALL).toBe(24);
    expect((await readSellerDashboardCatalog(seller, { q: literal.products[0].id })).total).toBe(1);
    expect((await readSellerDashboardCatalog(seller, { q: "Private other seller" })).total).toBe(0);
  });
  it("handles malformed/out-of-range filters separately from an empty page", async () => {
    await expect(readSellerDashboardCatalog(seller, { page: 3 })).rejects.toBeInstanceOf(ReadPageError);
    await expect(readSellerDashboardCatalog(seller, { sellerId: other.id })).rejects.toThrow();
    await expect(readSellerDashboardCatalog(seller, { status: "PENDING_APPROVAL" })).rejects.toThrow();
    expect(await readSellerDashboardCatalog(seller, { q: "absent product" })).toMatchObject({ total: 0, totalPages: 1, products: [] });
  });
  it("rejects suspended sellers, stale sessions and role changes", async () => {
    const blocked = await mockDatabase.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } });
    await expect(readSellerDashboardCatalog(seller, {})).rejects.toBeInstanceOf(ReadAccessError);
    await expect(readSellerDashboardCatalog(blocked, {})).rejects.toBeInstanceOf(ReadAccessError);
    const restored = await mockDatabase.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } });
    await expect(readSellerDashboardCatalog(seller, {})).rejects.toBeInstanceOf(ReadAccessError);
    expect((await readSellerDashboardCatalog(restored, {})).total).toBe(24);
    await mockDatabase.user.update({ where: { id: seller.id }, data: { role: "ADMIN" } });
    await expect(readSellerDashboardCatalog(restored, {})).rejects.toBeInstanceOf(ReadAccessError);
  });
  it("correlates an actual unavailable-table failure without returning a fake empty catalog", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mockDatabase.$executeRawUnsafe('ALTER TABLE "Product" RENAME TO "FixtureUnavailableProduct"');
      let caught: unknown; try { await readSellerDashboardCatalog(seller, {}); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ServiceUnavailableError); expect((caught as ServiceUnavailableError).incident.operation).toBe("seller.catalog");
      expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe((caught as ServiceUnavailableError).digest);
      expect(JSON.stringify(log.mock.calls)).not.toContain("FixtureUnavailableProduct");
    } finally { await mockDatabase.$executeRawUnsafe('ALTER TABLE "FixtureUnavailableProduct" RENAME TO "Product"'); log.mockRestore(); }
  });
});
