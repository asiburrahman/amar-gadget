import type { PrismaClient } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "192.0.2.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readTaxonomyOptions } from "@/lib/taxonomy-options";
import { GET as categories } from "@/app/api/categories/route";
import { GET as brands } from "@/app/api/brands/route";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceUnavailableError } from "@/lib/observability";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("bounded complete public taxonomy choices", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db; jest.clearAllMocks(); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    const root = await mockDatabase.category.create({ data: { name: "Parent category", slug: randomUUID() } });
    await mockDatabase.category.createMany({ data: Array.from({ length: 28 }, (_, index) => ({ name: index === 27 ? "Battery 50%_safe" : `Choice ${String(index).padStart(2, "0")}`, slug: randomUUID(), parentId: root.id })) });
    await mockDatabase.brand.createMany({ data: Array.from({ length: 28 }, (_, index) => ({ name: index === 27 ? "Brand 50%_safe" : `Brand ${String(index).padStart(2, "0")}`, slug: randomUUID() })) });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it.each(["category", "brand"] as const)("returns all %s choices through actual 25-record pages", async (kind) => {
    const first = await readTaxonomyOptions(kind), next = await readTaxonomyOptions(kind, { page: 2 });
    expect(first.items).toHaveLength(25); expect(next.items).toHaveLength(kind === "category" ? 4 : 3);
    expect(new Set([...first.items, ...next.items].map((row) => row.id)).size).toBe(kind === "category" ? 29 : 28);
    expect(first.totalPages).toBe(2); expect(first.limit).toBe(25);
    const response = await (kind === "category" ? categories : brands)(new Request(`http://localhost/api/${kind === "category" ? "categories" : "brands"}?page=2`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); const body = await response.json();
    expect(body.pagination.page).toBe(2); expect(body[kind === "category" ? "categories" : "brands"]).toHaveLength(next.items.length);
  });
  it("keeps base category names and complete ancestor labels even when the ancestor is on another page", async () => {
    const result = await readTaxonomyOptions("category", { q: "Parent category / Choice 26" });
    expect(result.total).toBe(1); expect(result.items[0]).toMatchObject({ name: "Choice 26", pathLabel: "Parent category / Choice 26" });
    expect(result.items[0].parentId).toBeTruthy(); expect((await readTaxonomyOptions("category", { q: "Parent category" })).total).toBe(29);
    expect((await readTaxonomyOptions("category", { q: "%_" })).total).toBe(1); expect((await readTaxonomyOptions("brand", { q: "%_" })).total).toBe(1);
  });
  it("distinguishes malformed requests, empty searches, expired option pages and rate denial", async () => {
    for (const query of ["?page=0", "?page=2&page=3", "?userId=foreign", "?q=line%0Abreak"]) expect((await categories(new Request(`http://localhost/api/categories${query}`))).status).toBe(400);
    expect(await readTaxonomyOptions("category", { q: "absent" })).toMatchObject({ total: 0, totalPages: 0, items: [] });
    expect(await readTaxonomyOptions("brand", { page: 3 })).toMatchObject({ total: 28, totalPages: 2, page: 3, items: [] });
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); expect((await brands(new Request("http://localhost/api/brands"))).status).toBe(429);
  });
  it.each(["Category", "Brand"])("correlates an actual missing %s table without a false empty success", async (table) => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mockDatabase.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME TO "FixtureUnavailableTaxonomy"`);
      const kind = table === "Category" ? "category" : "brand";
      await expect(readTaxonomyOptions(kind)).rejects.toBeInstanceOf(ServiceUnavailableError);
      const response = await (kind === "category" ? categories : brands)(new Request(`http://localhost/api/${kind === "category" ? "categories" : "brands"}`));
      expect(response.status).toBe(503); const body = await response.json(); expect(body.reference).toBe(response.headers.get("x-error-reference"));
      expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe(body.reference); expect(JSON.stringify(log.mock.calls)).not.toContain("FixtureUnavailableTaxonomy"); expect(body).not.toHaveProperty("pagination");
    } finally { await mockDatabase.$executeRawUnsafe(`ALTER TABLE "FixtureUnavailableTaxonomy" RENAME TO "${table}"`); log.mockRestore(); }
  });
});
