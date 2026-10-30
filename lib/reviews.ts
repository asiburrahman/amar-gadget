import { Prisma, type Review } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { isPublicProductImageUrl } from "@/lib/product-media-policy";
import { createReviewSchema, editReviewSchema, moderateReviewSchema, withdrawReviewSchema, REVIEW_PAGE_SIZE, type CreateReviewInput, type EditReviewInput, type ModerateReviewInput, type OwnedReview, type PublicReviewPage, type ReviewAccess, type ReviewProduct, type ReviewStatus } from "@/lib/validations/review";

export class ReviewError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
export const publishedReviewWhere: Prisma.ReviewWhereInput = {
  status: "PUBLISHED", isCanonical: true,
  orderItem: { is: { order: { is: { status: "DELIVERED", paymentStatus: "PAID" } } } },
};
const productSelect = { id: true, name: true, slug: true, imageUrl: true } satisfies Prisma.ProductSelect;
const ownerInclude = { product: { select: productSelect } } satisfies Prisma.ReviewInclude;
function productDto(product: ReviewProduct): ReviewProduct {
  return { ...product, imageUrl: product.imageUrl && isPublicProductImageUrl(product.imageUrl) ? product.imageUrl : null };
}
function ownerDto(review: Review & { product: ReviewProduct }): OwnedReview {
  return { id: review.id, version: review.version, rating: review.rating, comment: review.comment, status: review.status as ReviewStatus,
    isCanonical: review.isCanonical, product: productDto(review.product), moderationReason: review.moderationReason,
    createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString() };
}
function pages(total: number) { return Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)); }
function checkPage(page: number, total: number) {
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || page > pages(total)) throw new ReviewError("This review page does not exist.", "REVIEW_PAGE", 404);
}
export function reviewDisplayName(name: string | null) { return name?.trim().split(/\s+/)[0]?.slice(0, 60) || "Verified customer"; }
async function lockActor(tx: Prisma.TransactionClient, actor: AuthenticatedUser, role?: "ADMIN" | "MEMBER") {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, sessionVersion: true, isVerified: true, sellerStatus: true } });
  if (!current?.isVerified || current.role !== actor.role || current.sessionVersion !== actor.sessionVersion) throw new ReviewError("Your account changed. Refresh your session.", "REVIEW_ACCOUNT_CHANGED");
  if ((role && current.role !== role) || (role === "MEMBER" && current.sellerStatus !== "APPROVED")) throw new ReviewError("This review operation is not available for your account.", "FORBIDDEN", 403);
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, repeatableRead = false) {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout='3000ms'`; return work(tx); }, { timeout: 10_000, maxWait: 5000, ...(repeatableRead ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } : {}) });
}
async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id} FOR UPDATE`;
  const product = await tx.product.findUnique({ where: { id }, select: { ...productSelect, sellerId: true } });
  if (!product) throw new ReviewError("Product not found.", "PRODUCT_NOT_FOUND", 404);
  return product;
}
async function eligiblePurchase(tx: Prisma.TransactionClient, userId: string, productId: string) {
  return tx.orderItem.findFirst({ where: { productId, order: { userId, status: "DELIVERED", paymentStatus: "PAID" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, orderId: true } });
}
async function lockPurchase(tx: Prisma.TransactionClient, itemId: string) {
  const candidate = await tx.orderItem.findUnique({ where: { id: itemId }, select: { orderId: true } });
  if (!candidate) throw new ReviewError("The purchase is no longer available.", "REVIEW_INELIGIBLE", 403);
  // Payment/refund code uses the same Order-before-User direction. A review
  // never waits for an existing order while holding the product/account lock.
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${candidate.orderId} FOR UPDATE`;
  return tx.orderItem.findUniqueOrThrow({ where: { id: itemId }, include: { order: { select: { userId: true, status: true, paymentStatus: true } } } });
}
function assertPurchase(item: { productId: string; order: { userId: string; status: string; paymentStatus: string } }, userId: string, productId: string) {
  if (item.productId !== productId || item.order.userId !== userId || item.order.status !== "DELIVERED" || item.order.paymentStatus !== "PAID") throw new ReviewError("A delivered, paid purchase of this product is required.", "REVIEW_INELIGIBLE", 403);
}
/** Call with the Product lock held. Future refund/fulfillment changes must
 * reuse this reconciliation when they change delivered-purchase eligibility. */
export async function reconcileProductReviews(tx: Prisma.TransactionClient, productId: string) {
  const [summary] = await tx.$queryRaw<{ total: bigint; rating: number }[]>`
    SELECT count(*) AS total,COALESCE(avg(r.rating),0)::double precision AS rating
    FROM "Review" r JOIN "OrderItem" i ON i.id=r."orderItemId" JOIN "Order" o ON o.id=i."orderId" JOIN "Product" p ON p.id=r."productId"
    WHERE r."productId"=${productId} AND r.status='PUBLISHED' AND r."isCanonical"
      AND i."productId"=r."productId" AND o."userId"=r."userId" AND p."sellerId"<>r."userId"
      AND o.status='DELIVERED' AND o."paymentStatus"='PAID'`;
  await tx.product.update({ where: { id: productId }, data: { reviewCount: Number(summary.total), rating: summary.rating, reviewVersion: { increment: 1 } } });
}
export async function readPublicReviews(productId: string, page = 1): Promise<PublicReviewPage> {
  return transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, ...publicProductWhere }, select: { id: true, reviewVersion: true } });
    if (!product) throw new ReviewError("Product not found.", "PRODUCT_NOT_FOUND", 404);
    const where = { productId, ...publishedReviewWhere };
    const summary = await tx.review.aggregate({ where, _count: { id: true }, _avg: { rating: true } }); const total = summary._count.id; checkPage(page, total);
    const rows = await tx.review.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE, select: { id: true, rating: true, comment: true, createdAt: true, updatedAt: true, user: { select: { name: true } } } });
    return { productId, version: product.reviewVersion, page, total, totalPages: pages(total), rating: summary._avg.rating ?? 0,
      reviews: rows.map((row) => ({ id: row.id, rating: row.rating, comment: row.comment, displayName: reviewDisplayName(row.user.name), verifiedPurchase: true as const, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
  }, true);
}
export async function readReviewAccess(actor: AuthenticatedUser, productId: string): Promise<ReviewAccess> {
  return transaction(async (tx) => {
    await lockActor(tx, actor);
    const product = await tx.product.findUnique({ where: { id: productId }, select: { sellerId: true, status: true, seller: { select: { sellerStatus: true } } } });
    if (!product) throw new ReviewError("Product not found.", "PRODUCT_NOT_FOUND", 404);
    const review = await tx.review.findFirst({ where: { userId: actor.id, productId, isCanonical: true }, include: ownerInclude });
    const eligible = product.sellerId !== actor.id && !!await eligiblePurchase(tx, actor.id, productId);
    if (!review && !eligible && product.sellerId !== actor.id && (product.status !== "APPROVED" || product.seller.sellerStatus !== "APPROVED")) throw new ReviewError("Product not found.", "PRODUCT_NOT_FOUND", 404);
    return { ownerId: actor.id, productId, review: review ? ownerDto(review) : null, eligible, reason: eligible ? "Delivered paid purchase verified. New or edited reviews await moderation." : product.sellerId === actor.id ? "You cannot review your own product." : "Reviews require a delivered, paid purchase on this account." };
  });
}
export async function readOwnerReviews(actor: AuthenticatedUser, page = 1) {
  return transaction(async (tx) => {
    await lockActor(tx, actor); const where = { userId: actor.id }, total = await tx.review.count({ where }); checkPage(page, total);
    const reviews = await tx.review.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE, include: ownerInclude });
    return { ownerId: actor.id, reviews: reviews.map(ownerDto), total, page, totalPages: pages(total) };
  }, true);
}
export async function readEligibleReviews(actor: AuthenticatedUser, page = 1) {
  return transaction(async (tx) => {
    await lockActor(tx, actor);
    const [count] = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(DISTINCT p.id) AS total FROM "Product" p JOIN "OrderItem" i ON i."productId"=p.id JOIN "Order" o ON o.id=i."orderId"
      WHERE o."userId"=${actor.id} AND o.status='DELIVERED' AND o."paymentStatus"='PAID' AND p."sellerId"<>${actor.id}
      AND NOT EXISTS(SELECT 1 FROM "Review" r WHERE r."productId"=p.id AND r."userId"=${actor.id} AND r."isCanonical")`;
    const total = Number(count.total); checkPage(page, total); const offset = (page - 1) * REVIEW_PAGE_SIZE;
    const products = await tx.$queryRaw<ReviewProduct[]>`SELECT DISTINCT p.id,p.name,p.slug,p."imageUrl" FROM "Product" p JOIN "OrderItem" i ON i."productId"=p.id JOIN "Order" o ON o.id=i."orderId"
      WHERE o."userId"=${actor.id} AND o.status='DELIVERED' AND o."paymentStatus"='PAID' AND p."sellerId"<>${actor.id}
      AND NOT EXISTS(SELECT 1 FROM "Review" r WHERE r."productId"=p.id AND r."userId"=${actor.id} AND r."isCanonical")
      ORDER BY p.id LIMIT ${REVIEW_PAGE_SIZE} OFFSET ${offset}`;
    return { ownerId: actor.id, products: products.map(productDto), total, page, totalPages: pages(total) };
  }, true);
}
export async function createVerifiedReview(actor: AuthenticatedUser, input: CreateReviewInput) {
  const data = createReviewSchema.parse(input);
  return transaction(async (tx) => {
    const candidate = await eligiblePurchase(tx, actor.id, data.productId);
    if (!candidate) throw new ReviewError("A delivered, paid purchase of this product is required.", "REVIEW_INELIGIBLE", 403);
    const purchase = await lockPurchase(tx, candidate.id); await lockActor(tx, actor); const product = await lockProduct(tx, data.productId);
    assertPurchase(purchase, actor.id, data.productId);
    if (product.sellerId === actor.id) throw new ReviewError("You cannot review your own product.", "REVIEW_INELIGIBLE", 403);
    if (await tx.review.findFirst({ where: { userId: actor.id, productId: data.productId, isCanonical: true }, select: { id: true } })) throw new ReviewError("You already have a review for this product. Reload it to edit rather than submitting another.", "REVIEW_EXISTS");
    const saved = await tx.review.create({ data: { ...data, userId: actor.id, orderItemId: candidate.id, status: "PENDING" }, include: ownerInclude });
    return ownerDto(saved);
  });
}
export async function editVerifiedReview(actor: AuthenticatedUser, input: EditReviewInput) {
  const data = editReviewSchema.parse(input);
  return transaction(async (tx) => {
    const original = await tx.review.findFirst({ where: { id: data.id, userId: actor.id, isCanonical: true } });
    if (!original) throw new ReviewError("Review not found or this historical duplicate is read-only.", "REVIEW_NOT_FOUND", 404);
    const candidate = await eligiblePurchase(tx, actor.id, original.productId);
    if (!candidate) throw new ReviewError("A delivered, paid purchase is required to resubmit this review.", "REVIEW_INELIGIBLE", 403);
    const purchase = await lockPurchase(tx, candidate.id); await lockActor(tx, actor); const product = await lockProduct(tx, original.productId);
    await tx.$queryRaw`SELECT id FROM "Review" WHERE id=${data.id} FOR UPDATE`;
    const current = await tx.review.findUniqueOrThrow({ where: { id: data.id } });
    if (current.version !== data.version) throw new ReviewError("This review changed. Reload it before editing.", "REVIEW_CHANGED");
    assertPurchase(purchase, actor.id, current.productId); if (product.sellerId === actor.id) throw new ReviewError("You cannot review your own product.", "REVIEW_INELIGIBLE", 403);
    const saved = await tx.review.update({ where: { id: data.id }, data: { rating: data.rating, comment: data.comment, orderItemId: candidate.id, status: "PENDING", version: { increment: 1 }, moderationReason: null, moderatedById: null, moderatedAt: null }, include: ownerInclude });
    if (current.status === "PUBLISHED") await reconcileProductReviews(tx, current.productId);
    return ownerDto(saved);
  });
}
export async function withdrawVerifiedReview(actor: AuthenticatedUser, input: { id: string; version: number }) {
  const data = withdrawReviewSchema.parse(input);
  return transaction(async (tx) => {
    const original = await tx.review.findFirst({ where: { id: data.id, userId: actor.id, isCanonical: true } });
    if (!original || original.status === "LEGACY") throw new ReviewError("Review not found or this historical review needs resubmission first.", "REVIEW_NOT_FOUND", 404);
    if (original.orderItemId) await lockPurchase(tx, original.orderItemId);
    await lockActor(tx, actor); await lockProduct(tx, original.productId); await tx.$queryRaw`SELECT id FROM "Review" WHERE id=${data.id} FOR UPDATE`;
    const current = await tx.review.findUniqueOrThrow({ where: { id: data.id } }); if (current.version !== data.version) throw new ReviewError("This review changed. Reload it before withdrawing.", "REVIEW_CHANGED");
    if (current.status === "WITHDRAWN") return ownerDto(await tx.review.findUniqueOrThrow({ where: { id: data.id }, include: ownerInclude }));
    const saved = await tx.review.update({ where: { id: data.id }, data: { status: "WITHDRAWN", version: { increment: 1 }, moderationReason: null, moderatedById: null, moderatedAt: null }, include: ownerInclude });
    if (current.status === "PUBLISHED") await reconcileProductReviews(tx, current.productId); return ownerDto(saved);
  });
}
export async function moderateVerifiedReview(actor: AuthenticatedUser, input: ModerateReviewInput) {
  const data = moderateReviewSchema.parse(input);
  return transaction(async (tx) => {
    const original = await tx.review.findUnique({ where: { id: data.id } });
    if (!original) throw new ReviewError("Review not found.", "REVIEW_NOT_FOUND", 404);
    const purchase = original.orderItemId ? await lockPurchase(tx, original.orderItemId) : null;
    await lockActor(tx, actor, "ADMIN"); await lockProduct(tx, original.productId); await tx.$queryRaw`SELECT id FROM "Review" WHERE id=${data.id} FOR UPDATE`;
    const current = await tx.review.findUniqueOrThrow({ where: { id: data.id } });
    if (current.version !== data.version) throw new ReviewError("This review changed. Reload it before moderating.", "REVIEW_CHANGED");
    if (!current.isCanonical || current.status === "LEGACY" || current.status === "WITHDRAWN" || !purchase) throw new ReviewError("Only a submitted canonical purchase review can be moderated. Legacy reviews require owner resubmission; withdrawn reviews require owner consent.", "REVIEW_STATE");
    const status = data.action === "publish" ? "PUBLISHED" : "REJECTED";
    if (status === "PUBLISHED") assertPurchase(purchase, current.userId, current.productId);
    if (current.status === status && (status === "PUBLISHED" || current.moderationReason === data.reason)) return ownerDto(await tx.review.findUniqueOrThrow({ where: { id: data.id }, include: ownerInclude }));
    const saved = await tx.review.update({ where: { id: data.id }, data: { status, version: { increment: 1 }, moderationReason: status === "REJECTED" ? data.reason! : null, moderatedById: actor.id, moderatedAt: new Date() }, include: ownerInclude });
    if (current.status === "PUBLISHED" || status === "PUBLISHED") await reconcileProductReviews(tx, current.productId);
    return ownerDto(saved);
  });
}
export async function readModerationReviews(actor: AuthenticatedUser, status: ReviewStatus | "ALL" = "PENDING", page = 1) {
  return transaction(async (tx) => {
    await lockActor(tx, actor, "ADMIN"); const where: Prisma.ReviewWhereInput = status === "ALL" ? {} : { status };
    const total = await tx.review.count({ where }); checkPage(page, total);
    const reviews = await tx.review.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE, include: { ...ownerInclude, user: { select: { name: true } } } });
    return { ownerId: actor.id, reviews: reviews.map((review) => ({ ...ownerDto(review), displayName: reviewDisplayName(review.user.name) })), total, page, totalPages: pages(total) };
  }, true);
}
export async function readSellerReviews(actor: AuthenticatedUser, page = 1) {
  return transaction(async (tx) => {
    await lockActor(tx, actor, "MEMBER"); const where: Prisma.ReviewWhereInput = { ...publishedReviewWhere, product: { sellerId: actor.id } };
    const total = await tx.review.count({ where }); checkPage(page, total);
    const reviews = await tx.review.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE, include: { ...ownerInclude, user: { select: { name: true } } } });
    return { ownerId: actor.id, reviews: reviews.map((review) => ({ id: review.id, rating: review.rating, comment: review.comment, product: productDto(review.product), displayName: reviewDisplayName(review.user.name), verifiedPurchase: true as const, createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString() })), total, page, totalPages: pages(total) };
  }, true);
}
