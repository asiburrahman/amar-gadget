import { z } from "zod";
import { catalogIdSchema } from "@/lib/validations/product";

export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_STATUSES = ["LEGACY", "PENDING", "PUBLISHED", "REJECTED", "WITHDRAWN"] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export const reviewCommentSchema = z.string().trim().max(2000).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Use plain review text.").transform((value) => value || null).nullable();
const content = { rating: z.number().int().min(1).max(5), comment: reviewCommentSchema };
export const createReviewSchema = z.object({ productId: catalogIdSchema, ...content }).strict();
export const editReviewSchema = z.object({ id: catalogIdSchema, version: z.number().int().min(1).max(2_147_483_646), ...content }).strict();
export const withdrawReviewSchema = editReviewSchema.pick({ id: true, version: true });
export const moderateReviewSchema = z.object({
  id: catalogIdSchema, version: z.number().int().min(1).max(2_147_483_646), action: z.enum(["publish", "reject"]),
  reason: z.string().trim().max(300).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a plain moderation reason.").optional(),
}).strict().refine((value) => value.action !== "reject" || !!value.reason, "Explain why this review was rejected.");
export const reviewPageSchema = z.coerce.number().int().min(1).max(1_000_000).default(1);
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type EditReviewInput = z.infer<typeof editReviewSchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
export type ReviewStatus = typeof REVIEW_STATUSES[number];
export type PublicReview = { id: string; rating: number; comment: string | null; createdAt: string; updatedAt: string; displayName: string; verifiedPurchase: true };
export type PublicReviewPage = { productId: string; rating: number; total: number; version: number; reviews: PublicReview[]; page: number; totalPages: number };
export type ReviewProduct = { id: string; name: string; slug: string; imageUrl: string | null };
export type OwnedReview = { id: string; version: number; rating: number; comment: string | null; status: ReviewStatus; isCanonical: boolean; product: ReviewProduct; moderationReason: string | null; createdAt: string; updatedAt: string };
export type ReviewAccess = { ownerId: string; productId: string; review: OwnedReview | null; eligible: boolean; reason: string };
export type OwnerReviewPage = { ownerId: string; reviews: OwnedReview[]; total: number; page: number; totalPages: number };
export type EligibleReviewPage = { ownerId: string; products: ReviewProduct[]; total: number; page: number; totalPages: number };
