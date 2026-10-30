import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { publicProductMedia } from "@/lib/product-media-policy";
import { publishedReviewWhere, reviewDisplayName } from "@/lib/reviews";
export const getPublicProduct = cache(async (identifier: string) => {
  if (!identifier || identifier.length > 512 || /[\u0000-\u001f\u007f]/.test(identifier)) return null;
  const include = { category: true, brand: true, seller: { select: { id: true, name: true } }, reviews: { where: publishedReviewWhere, take: 20, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], select: { id: true, rating: true, comment: true, createdAt: true, updatedAt: true, user: { select: { name: true } } } } };
  const exact = await prisma.product.findFirst({ where: { ...publicProductWhere, slug: identifier }, include });
  const serialize = (product: NonNullable<typeof exact>) => ({ ...product, ...publicProductMedia(product), reviews: product.reviews.map(({ user, ...review }) => ({ ...review, user: { name: reviewDisplayName(user.name) }, verifiedPurchase: true as const })) });
  if (exact) return serialize(exact);
  // Do not reinterpret a hidden exact slug as another public product's ID.
  if (await prisma.product.findUnique({ where: { slug: identifier }, select: { id: true } })) return null;
  const byId = await prisma.product.findFirst({ where: { ...publicProductWhere, id: identifier }, include });
  if (byId) return serialize(byId);
  // Equality must remain literal even for percent/underscore legacy slugs.
  const aliases = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE lower(slug) = lower(${identifier}) ORDER BY id LIMIT 2`;
  if (aliases.length !== 1) return null;
  const product = await prisma.product.findFirst({ where: { ...publicProductWhere, id: aliases[0].id }, include });
  return product ? serialize(product) : null;
});
