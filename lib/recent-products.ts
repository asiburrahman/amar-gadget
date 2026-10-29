import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { recentIdsSchema } from "@/lib/validations/recent-history";
import { isPublicProductImageUrl } from "@/lib/product-media-policy";
export async function getRecentProducts(input: unknown) {
  const ids = recentIdsSchema.parse(input);
  if (!ids.length) return [];
  const rows = await prisma.product.findMany({ where: { ...publicProductWhere, id: { in: ids } }, take: 20,
    select: { id: true, slug: true, name: true, price: true, discountPrice: true, stock: true, imageUrl: true, rating: true, category: { select: { name: true } } } });
  return ids.flatMap((id) => { const row = rows.find((product) => product.id === id); return row ? [{ ...row, price: Number(row.price), discountPrice: row.discountPrice === null ? null : Number(row.discountPrice), category: row.category.name, imageUrl: row.imageUrl && isPublicProductImageUrl(row.imageUrl) ? row.imageUrl : undefined }] : []; });
}
export type RecentProduct = Awaited<ReturnType<typeof getRecentProducts>>[number];
