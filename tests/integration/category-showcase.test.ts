import type { PrismaClient, Category } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readCategoryShowcase } from "@/lib/category-showcase";
import { ServiceUnavailableError } from "@/lib/observability";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("server-paged category showcase", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, root: Category, last: Category, empty: Category;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    const seller = await mockDatabase.user.create({ data: { email: `${randomUUID()}@showcase.example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "APPROVED" } });
    const blocked = await mockDatabase.user.create({ data: { email: `${randomUUID()}@showcase.example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "BLOCKED" } });
    root = await mockDatabase.category.create({ data: { name: "Parent phones", slug: randomUUID() } });
    const children: Category[] = [];
    for (let index = 0; index < 28; index++) children.push(await mockDatabase.category.create({ data: { name: `Case ${String(index).padStart(2, "0")}`, slug: randomUUID(), parentId: root.id } }));
    last = children.at(-1)!; empty = children[20];
    const other = await mockDatabase.category.create({ data: { name: "Unrelated computers", slug: randomUUID() } });
    await mockDatabase.product.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ name: `Actual phone case ${index}`, slug: randomUUID(), sellerId: seller.id, categoryId: index === 25 ? last.id : children[0].id, status: "APPROVED", stock: 10, price: 100, createdAt: new Date("2026-01-01Z") })) });
    await mockDatabase.product.createMany({ data: [
      { name: "Unrelated laptop", slug: randomUUID(), sellerId: seller.id, categoryId: other.id, status: "APPROVED", stock: 10, price: 200 },
      { name: "Hidden pending case", slug: randomUUID(), sellerId: seller.id, categoryId: last.id, status: "PENDING_APPROVAL", stock: 10, price: 100 },
      { name: "Hidden blocked case", slug: randomUUID(), sellerId: blocked.id, categoryId: last.id, status: "APPROVED", stock: 10, price: 100 },
    ] });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it("pages the full descendant catalog independently of the 25-category choice page", async () => {
    const first = await readCategoryShowcase({ categoryId: root.id }), second = await readCategoryShowcase({ categoryId: root.id, page: 2 }), third = await readCategoryShowcase({ categoryId: root.id, page: 3 });
    expect(first.choices.items).toHaveLength(25); expect(first.choices.total).toBe(30);
    expect(first.listing).toMatchObject({ total: 26, totalPages: 3, limit: 12 }); expect(first.listing.products).toHaveLength(12); expect(second.listing.products).toHaveLength(12); expect(third.listing.products).toHaveLength(2);
    expect(new Set([...first.listing.products, ...second.listing.products, ...third.listing.products].map((product) => product.id)).size).toBe(26);
    expect([...first.listing.products, ...second.listing.products, ...third.listing.products].every((product) => product.name.startsWith("Actual phone case"))).toBe(true);
    expect((await readCategoryShowcase()).listing.total).toBe(27);
  });
  it("retains the selected full ancestor label when browsing unrelated/empty category choices", async () => {
    const result = await readCategoryShowcase({ categoryId: last.id, q: "Unrelated", categoryPage: 1 });
    expect(result.choices.items).toHaveLength(1); expect(result.selected).toMatchObject({ id: last.id, baseName: "Case 27", name: "Parent phones / Case 27" });
    expect(result.listing.total).toBe(1); expect(result.listing.products[0].name).toBe("Actual phone case 25");
    const noChoices = await readCategoryShowcase({ categoryId: last.id, q: "absent" }); expect(noChoices.choices.total).toBe(0); expect(noChoices.listing.total).toBe(1);
  });
  it("keeps missing, empty, invalid and expired results distinct without unrelated-product fallback", async () => {
    expect((await readCategoryShowcase({ categoryId: empty.id })).listing).toMatchObject({ total: 0, products: [], categoryFilter: { state: "found" } });
    expect((await readCategoryShowcase({ categoryId: randomUUID() })).listing).toMatchObject({ total: 0, products: [], categoryFilter: { state: "missing" } });
    expect((await readCategoryShowcase({ categoryId: root.id, page: 4 })).listing.outOfRange).toBe(true);
    expect((await readCategoryShowcase({ categoryPage: 3 })).choices).toMatchObject({ total: 30, page: 3, items: [] });
    await expect(readCategoryShowcase({ categoryId: "malformed?" })).rejects.toThrow(); await expect(readCategoryShowcase({ page: 0 })).rejects.toThrow(); await expect(readCategoryShowcase({ sellerId: "foreign" })).rejects.toThrow();
  });
  it("propagates an actual unavailable product table as a service incident", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mockDatabase.$executeRawUnsafe('ALTER TABLE "Product" RENAME TO "FixtureUnavailableProduct"');
      await expect(readCategoryShowcase({ categoryId: root.id })).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect(JSON.stringify(log.mock.calls)).not.toContain("FixtureUnavailableProduct");
    } finally { await mockDatabase.$executeRawUnsafe('ALTER TABLE "FixtureUnavailableProduct" RENAME TO "Product"'); log.mockRestore(); }
  });
});
