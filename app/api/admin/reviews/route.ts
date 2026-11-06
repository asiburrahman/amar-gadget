import { NextResponse } from "next/server";
import { z } from "zod";
import { moderateReviewSchema, reviewPageSchema, REVIEW_STATUSES } from "@/lib/validations/review";
import { moderateVerifiedReview, readModerationReviews } from "@/lib/reviews";
import { readAccountJson } from "@/lib/account-request";
import { invalidateReviewPages, reviewActor, reviewFailure, reviewPrivateHeaders, reviewQuery } from "@/lib/review-request";
export async function GET(request: Request) {
  try {
    const actor = await reviewActor(request, { role: "ADMIN" });
    const input = z.object({ status: z.enum(["ALL", ...REVIEW_STATUSES]).default("PENDING"), page: reviewPageSchema }).strict().parse(reviewQuery(request));
    return NextResponse.json({ success: true, ...await readModerationReviews(actor, input.status, input.page) }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await reviewActor(request, { role: "ADMIN", write: true }), input = moderateReviewSchema.parse(await readAccountJson(request, 2048));
    const review = await moderateVerifiedReview(actor, input); invalidateReviewPages(review);
    return NextResponse.json({ success: true, ownerId: actor.id, review }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
