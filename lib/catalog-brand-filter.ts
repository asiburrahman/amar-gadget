import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { brandFilterSchema } from "@/lib/validations/catalog-brand";

export type CatalogBrand = { id: string; name: string; slug: string };
export type BrandFilterResult = { state: "none" } | { state: "found"; brand: CatalogBrand } | { state: "missing" } | { state: "invalid"; message: string };
const select = { id: true, name: true, slug: true } as const;

// Primitive arguments let metadata and the page share request-scoped React
// memoization. There is no persistent negative/brand cache across requests.
export const resolveCatalogBrand = cache(async (brand: unknown, brandId: unknown): Promise<BrandFilterResult> => {
  const parsed = brandFilterSchema.safeParse({ brand, brandId });
  if (!parsed.success) return { state: "invalid", message: "Invalid brand filter. Select one brand." };
  const values = parsed.data;
  if (!values.brand && !values.brandId) return { state: "none" };
  let byValue: CatalogBrand | null = null;
  if (values.brand) {
    // Generated links use the exact stored slug. IDs remain supported for old
    // callers; only an unambiguous case-insensitive slug is a fallback.
    byValue = await prisma.brand.findUnique({ where: { slug: values.brand }, select });
    if (!byValue) byValue = await prisma.brand.findUnique({ where: { id: values.brand }, select });
    if (!byValue) {
      // ILIKE-backed ORM equality treats %/_ as patterns. Case folding must
      // remain literal equality for a brand identifier, with a bound result.
      const matches = await prisma.$queryRaw<CatalogBrand[]>`SELECT id, name, slug FROM "Brand" WHERE lower(slug) = lower(${values.brand}) ORDER BY id LIMIT 2`;
      if (matches.length > 1) return { state: "invalid", message: "This brand filter is ambiguous. Use its brand ID." };
      byValue = matches[0] ?? null;
    }
  }
  const byId = values.brandId ? await prisma.brand.findUnique({ where: { id: values.brandId }, select }) : null;
  if ((values.brand && !byValue) || (values.brandId && !byId)) return { state: "missing" };
  if (byValue && byId && byValue.id !== byId.id) return { state: "invalid", message: "The brand and brand ID select different brands." };
  const selected = byValue ?? byId;
  return selected ? { state: "found", brand: selected } : { state: "missing" };
});
