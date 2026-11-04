jest.mock("@/lib/prisma", () => ({ prisma: { category: { findUnique: jest.fn() }, brand: { findUnique: jest.fn() }, $queryRaw: jest.fn() } }));
import { prisma } from "@/lib/prisma";
import { resolveCatalogCategory } from "@/lib/catalog-category-filter";
import { resolveCatalogBrand } from "@/lib/catalog-brand-filter";
import { ServiceUnavailableError } from "@/lib/observability";
beforeEach(() => { jest.clearAllMocks(); (prisma.category.findUnique as jest.Mock).mockResolvedValue(null); (prisma.brand.findUnique as jest.Mock).mockResolvedValue(null); (prisma.$queryRaw as jest.Mock).mockResolvedValue([]); });
it.each(["category", "brand"])("keeps genuinely missing/invalid %s filters distinct from an unavailable lookup", async (kind) => {
  const lookup = kind === "category" ? resolveCatalogCategory : resolveCatalogBrand;
  expect(await lookup(undefined, undefined)).toEqual({ state: "none" }); expect(await lookup("absent", undefined)).toEqual({ state: "missing" }); expect((await lookup(["one", "two"], undefined)).state).toBe("invalid");
});
it.each(["category", "brand"])("sanitizes both direct and alias %s failures before page/metadata callers receive them", async (kind) => {
  const lookup = kind === "category" ? resolveCatalogCategory : resolveCatalogBrand, model = kind === "category" ? prisma.category : prisma.brand;
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    for (const stage of ["direct", "alias"]) {
      const failure = Object.assign(Error("private database URL password"), { code: "P1001" });
      if (stage === "direct") (model.findUnique as jest.Mock).mockRejectedValueOnce(failure); else (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(failure);
      let caught: unknown; try { await lookup("stored-slug", undefined); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ServiceUnavailableError); expect((caught as ServiceUnavailableError).incident.operation).toBe(`taxonomy.${kind}`);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe((caught as ServiceUnavailableError).digest);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("private database");
  } finally { log.mockRestore(); }
});
