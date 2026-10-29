import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { comparisonIdsSchema } from "@/lib/validations/comparison";
import { specificationsSchema } from "@/lib/validations/specifications";

export async function getProductComparison(input: unknown) {
  const ids = comparisonIdsSchema.parse(input);
  if (!ids.length) return { products: [], missing: [] as string[] };
  const products = await prisma.product.findMany({ where: { ...publicProductWhere, id: { in: ids } }, take: 4,
    select: { id: true, slug: true, name: true, description: true, price: true, discountPrice: true, stock: true, specifications: true, category: { select: { name: true } }, brand: { select: { name: true } } } });
  const ordered = ids.flatMap((id) => { const row = products.find((product) => product.id === id); return row ? [{ ...row, price: Number(row.price), discountPrice: row.discountPrice === null ? null : Number(row.discountPrice), specifications: specificationsSchema.parse(row.specifications) }] : []; });
  return { products: ordered, missing: ids.filter((id) => !ordered.some((product) => product.id === id)) };
}
