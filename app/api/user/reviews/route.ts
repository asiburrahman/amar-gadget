import { NextResponse } from "next/server";
import { z } from "zod";
import { catalogIdSchema } from "@/lib/validations/product";
import { createReviewSchema, editReviewSchema, reviewPageSchema, withdrawReviewSchema } from "@/lib/validations/review";
import { createVerifiedReview, editVerifiedReview, readEligibleReviews, readOwnerReviews, readReviewAccess, withdrawVerifiedReview } from "@/lib/reviews";
import { readAccountJson } from "@/lib/account-request";
import { invalidateReviewPages, reviewActor, reviewFailure, reviewPrivateHeaders, reviewQuery } from "@/lib/review-request";
export async function GET(request: Request) {
  try {
    const actor = await reviewActor(request);
    const input = z.union([z.object({ productId: catalogIdSchema }).strict(), z.object({ tab: z.enum(["mine", "eligible"]).default("mine"), page: reviewPageSchema }).strict()]).parse(reviewQuery(request));
    const result = "productId" in input ? await readReviewAccess(actor, input.productId) : input.tab === "eligible" ? await readEligibleReviews(actor, input.page) : await readOwnerReviews(actor, input.page);
    return NextResponse.json({ success: true, ...result }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await reviewActor(request, { write: true }), input = createReviewSchema.parse(await readAccountJson(request, 8192));
    const review = await createVerifiedReview(actor, input); invalidateReviewPages(review);
    return NextResponse.json({ success: true, ownerId: actor.id, review }, { status: 201, headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
export async function PUT(request: Request) {
  try {
    const actor = await reviewActor(request, { write: true }), input = editReviewSchema.parse(await readAccountJson(request, 8192));
    const review = await editVerifiedReview(actor, input); invalidateReviewPages(review);
    return NextResponse.json({ success: true, ownerId: actor.id, review }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const actor = await reviewActor(request, { write: true }), input = withdrawReviewSchema.parse(await readAccountJson(request, 1024));
    const review = await withdrawVerifiedReview(actor, input); invalidateReviewPages(review);
    return NextResponse.json({ success: true, ownerId: actor.id, review }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
