import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readAdminCatalog } from "@/lib/admin-catalog-read";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { ServiceUnavailableError } from "@/lib/observability";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("bounded current-authority administrator product reads", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, seller: User, blocked: User;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [admin, seller, blocked] = await Promise.all(["ADMIN", "MEMBER", "MEMBER"].map((role, index) => mockDatabase.user.create({ data: { email: `${randomUUID()}@catalog-read.example.invalid`, name: index === 1 ? "Approved Seller" : "Other operator", role, sellerStatus: index === 2 ? "BLOCKED" : "APPROVED", isVerified: true } })));
    const category = await mockDatabase.category.create({ data: { name: "Actual category", slug: randomUUID() } });
    await mockDatabase.product.createMany({ data: Array.from({ length: 22 }, (_, index) => ({ name: `Platform product ${index}`, slug: randomUUID(), categoryId: category.id, sellerId: index < 11 ? seller.id : blocked.id, status: index % 2 ? "PENDING_APPROVAL" : "APPROVED", price: 100, stock: 4 })) });
    await mockDatabase.product.createMany({ data: ["Battery 50%_safe", "Battery 500Xsafe"].map((name) => ({ name, slug: randomUUID(), categoryId: category.id, sellerId: seller.id, status: "APPROVED", price: 150, stock: 3 })) });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it("returns every matching product through stable 20-row pages and retains editing/moderation data", async () => {
    const first = await readAdminCatalog(admin, {}), second = await readAdminCatalog(admin, { page: 2 });
    expect(first).toMatchObject({ total: 24, totalPages: 2, pageSize: 20 }); expect(first.products).toHaveLength(20); expect(second.products).toHaveLength(4); expect(new Set([...first.products, ...second.products].map((row) => row.id)).size).toBe(24);
    expect(first.products[0]).toHaveProperty("specifications"); expect(first.products[0]).toHaveProperty("catalogVersion"); expect(first.products[0].category.name).toBe("Actual category"); expect(first.products[0].seller.email).toBeTruthy();
    // Global administrator moderation includes blocked sellers' retained rows.
    expect((await readAdminCatalog(admin, { q: blocked.email })).total).toBe(11);
  });
  it("applies whole-scope status/text filters and treats SQL search metacharacters literally", async () => {
    expect((await readAdminCatalog(admin, { status: "PENDING_APPROVAL" })).total).toBe(11); expect((await readAdminCatalog(admin, { status: "APPROVED" })).total).toBe(13);
    const literal = await readAdminCatalog(admin, { q: "%_" }); expect(literal.total).toBe(1); expect(literal.products[0].name).toBe("Battery 50%_safe"); expect((await readAdminCatalog(admin, { q: literal.products[0].id })).total).toBe(1); expect((await readAdminCatalog(admin, { q: "APPROVED SELLER" })).total).toBe(13);
    expect((await readAdminCatalog(admin, { q: "not a product" })).total).toBe(0);
  });
  it("distinguishes malformed/out-of-range queries from a genuine empty first page", async () => {
    await expect(readAdminCatalog(admin, { page: 3 })).rejects.toBeInstanceOf(ReadPageError); await expect(readAdminCatalog(admin, { page: 0 })).rejects.toThrow(); await expect(readAdminCatalog(admin, { status: "forged", actorId: seller.id })).rejects.toThrow();
    expect(await readAdminCatalog(admin, { status: "ARCHIVED" })).toMatchObject({ total: 0, totalPages: 1, products: [] });
  });
  it("rejects foreign roles and stale role/session snapshots before returning catalog data", async () => {
    await expect(readAdminCatalog(seller, {})).rejects.toBeInstanceOf(ReadAccessError);
    await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "USER" } }); await expect(readAdminCatalog(admin, {})).rejects.toBeInstanceOf(ReadAccessError);
    const restored = await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } }); await expect(readAdminCatalog(admin, {})).rejects.toBeInstanceOf(ReadAccessError); expect((await readAdminCatalog(restored, {})).total).toBe(24);
  });
  it("returns a sanitized correlated failure for an actual unavailable table instead of an empty catalog", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // This suite owns the new random database; rename models schema failure
      // without deleting source records or touching the primary fixture.
      await mockDatabase.$executeRawUnsafe('ALTER TABLE "Product" RENAME TO "FixtureUnavailableProduct"');
      let caught: unknown; try { await readAdminCatalog(admin, {}); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ServiceUnavailableError); expect((caught as ServiceUnavailableError).incident.operation).toBe("admin.catalog"); expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe((caught as ServiceUnavailableError).digest); expect(JSON.stringify(log.mock.calls)).not.toContain("FixtureUnavailableProduct");
    } finally { await mockDatabase.$executeRawUnsafe('ALTER TABLE "FixtureUnavailableProduct" RENAME TO "Product"'); log.mockRestore(); }
  });
});
