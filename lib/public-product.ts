import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
export const getPublicProduct = cache(async (identifier: string) => {
  if (!identifier || identifier.length > 512 || /[\u0000-\u001f\u007f]/.test(identifier)) return null;
  const include = { category: true, brand: true, seller: { select: { id: true, name: true } }, reviews: { take: 20, orderBy: { createdAt: "desc" as const }, include: { user: { select: { name: true, avatar: true } } } } };
  const exact = await prisma.product.findFirst({ where: { ...publicProductWhere, slug: identifier }, include });
  if (exact) return exact;
  // Do not reinterpret a hidden exact slug as another public product's ID.
  if (await prisma.product.findUnique({ where: { slug: identifier }, select: { id: true } })) return null;
  const byId = await prisma.product.findFirst({ where: { ...publicProductWhere, id: identifier }, include });
  if (byId) return byId;
  // Equality must remain literal even for percent/underscore legacy slugs.
  const aliases = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE lower(slug) = lower(${identifier}) ORDER BY id LIMIT 2`;
  if (aliases.length !== 1) return null;
  return prisma.product.findFirst({ where: { ...publicProductWhere, id: aliases[0].id }, include });
});
