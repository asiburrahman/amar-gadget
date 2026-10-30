import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewPageSchema } from "@/lib/validations/review";
import { readSellerReviews } from "@/lib/reviews";
import { reviewActor, reviewFailure, reviewPrivateHeaders, reviewQuery } from "@/lib/review-request";
export async function GET(request: Request) {
  try {
    const actor = await reviewActor(request, { role: "MEMBER" });
    const input = z.object({ page: reviewPageSchema }).strict().parse(reviewQuery(request));
    return NextResponse.json({ success: true, ...await readSellerReviews(actor, input.page) }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
