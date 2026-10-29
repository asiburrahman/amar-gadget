import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { isPublicProductImageUrl } from "@/lib/product-media-policy";
import { MAX_WISHLIST_ITEMS } from "@/lib/validations/wishlist";
export class WishlistError extends Error { constructor(message: string, readonly status: number, readonly code: string) { super(message); } }
const productSelect = { id: true, slug: true, name: true, price: true, discountPrice: true, stock: true, imageUrl: true, category: { select: { name: true } } } satisfies Prisma.ProductSelect;
export async function resolveWishlistProducts(ids: string[], db: Pick<Prisma.TransactionClient, "product"> = prisma) {
  const products = await db.product.findMany({ where: { id: { in: ids }, ...publicProductWhere }, select: productSelect });
  const mapped = new Map(products.map((product) => [product.id, { ...product, price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice), imageUrl: product.imageUrl && isPublicProductImageUrl(product.imageUrl) ? product.imageUrl : null, category: product.category.name }]));
  return ids.map((id) => ({ id, product: mapped.get(id) ?? null }));
}
async function withOwner<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient, version: number) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { sessionVersion: true, isVerified: true, role: true, wishlistVersion: true } });
    if (!current?.isVerified || current.sessionVersion !== actor.sessionVersion || current.role !== actor.role) throw new WishlistError("Your account changed. Refresh your session.", 409, "ACCOUNT_CHANGED");
    return work(tx, current.wishlistVersion);
  }, { timeout: 10_000, maxWait: 5000 });
}
export async function readWishlist(actor: AuthenticatedUser, page: number) {
  return withOwner(actor, async (tx, version) => {
    const total = await tx.wishlist.count({ where: { userId: actor.id } }), totalPages = Math.ceil(total / 200);
    const rows = page > Math.max(1, totalPages) ? [] : await tx.wishlist.findMany({ where: { userId: actor.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { productId: true }, skip: (page - 1) * 200, take: 200 });
    return { ownerId: actor.id, version, total, totalPages, page, items: await resolveWishlistProducts(rows.map((row) => row.productId), tx) };
  });
}
export async function addWishlistProducts(actor: AuthenticatedUser, productIds: string[], merge: boolean) {
  return withOwner(actor, async (tx, version) => {
    const available = await tx.product.findMany({ where: { id: { in: productIds }, ...publicProductWhere }, select: { id: true } });
    const acceptedIds = available.map((product) => product.id), skippedIds = productIds.filter((id) => !acceptedIds.includes(id));
    if (!merge && skippedIds.length) throw new WishlistError("A selected product is no longer available to save.", 409, "PRODUCT_UNAVAILABLE");
    const [count, existing] = await Promise.all([tx.wishlist.count({ where: { userId: actor.id } }), tx.wishlist.findMany({ where: { userId: actor.id, productId: { in: acceptedIds } }, select: { productId: true } })]);
    const additions = acceptedIds.filter((id) => !existing.some((row) => row.productId === id));
    if (additions.length && count + additions.length > MAX_WISHLIST_ITEMS) throw new WishlistError("You can save up to 200 products. Remove some before adding or merging more.", 409, "WISHLIST_LIMIT");
    const created = additions.length ? await tx.wishlist.createMany({ data: additions.map((productId) => ({ userId: actor.id, productId })), skipDuplicates: true }) : { count: 0 };
    if (created.count) await tx.user.update({ where: { id: actor.id }, data: { wishlistVersion: { increment: 1 } } });
    return { ownerId: actor.id, version: version + (created.count ? 1 : 0), acceptedIds, skippedIds, added: created.count };
  });
}
export async function removeWishlistProducts(actor: AuthenticatedUser, input: { productIds: string[] } | { clear: true; version: number }) {
  return withOwner(actor, async (tx, version) => {
    if ("clear" in input && input.version !== version) throw new WishlistError("Your wishlist changed in another session. Refresh before clearing it.", 409, "WISHLIST_CHANGED");
    const removed = await tx.wishlist.deleteMany({ where: { userId: actor.id, ...("productIds" in input ? { productId: { in: input.productIds } } : {}) } });
    if (removed.count) await tx.user.update({ where: { id: actor.id }, data: { wishlistVersion: { increment: 1 } } });
    return { ownerId: actor.id, version: version + (removed.count ? 1 : 0), removed: removed.count };
  });
}
