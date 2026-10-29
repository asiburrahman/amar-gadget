import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { brandFilterSchema } from "@/lib/validations/catalog-brand";

export type CatalogCategory = { id: string; name: string; slug: string };
export type CategoryFilterResult = { state: "none" } | { state: "found"; category: CatalogCategory } | { state: "missing" } | { state: "invalid"; message: string };
const select = { id: true, name: true, slug: true } as const;
export const resolveCatalogCategory = cache(async (category: unknown, categoryId: unknown): Promise<CategoryFilterResult> => {
  const parsed = brandFilterSchema.safeParse({ brand: category, brandId: categoryId });
  if (!parsed.success) return { state: "invalid", message: "Invalid category filter. Select one category." };
  const { brand: value, brandId: id } = parsed.data;
  if (!value && !id) return { state: "none" };
  let byValue: CatalogCategory | null = null;
  if (value) {
    byValue = await prisma.category.findUnique({ where: { slug: value }, select });
    if (!byValue) byValue = await prisma.category.findUnique({ where: { id: value }, select });
    if (!byValue) {
      const matches = await prisma.$queryRaw<CatalogCategory[]>`SELECT id, name, slug FROM "Category" WHERE lower(slug) = lower(${value}) OR lower(name) = lower(${value}) ORDER BY id LIMIT 2`;
      if (matches.length > 1) return { state: "invalid", message: "This category is ambiguous. Use its category ID." };
      byValue = matches[0] ?? null;
    }
    const alias = { wearables: "smart-watches", computers: "laptops" }[value.toLowerCase()];
    if (!byValue && alias) byValue = await prisma.category.findUnique({ where: { slug: alias }, select });
  }
  const byId = id ? await prisma.category.findUnique({ where: { id }, select }) : null;
  if ((value && !byValue) || (id && !byId)) return { state: "missing" };
  if (byValue && byId && byValue.id !== byId.id) return { state: "invalid", message: "The category and category ID select different categories." };
  const selected = byValue ?? byId;
  return selected ? { state: "found", category: selected } : { state: "missing" };
});
