import { NextResponse } from "next/server";
import { z } from "zod";
import { catalogIdSchema } from "@/lib/validations/product";
import { reviewPageSchema } from "@/lib/validations/review";
import { readPublicReviews } from "@/lib/reviews";
import { limitAccountIp } from "@/lib/account-request";
import { reviewFailure, reviewPrivateHeaders, reviewQuery } from "@/lib/review-request";

export async function GET(req: Request) {
  try {
    await limitAccountIp(req, "public-reviews", 120);
    const input = z.object({ productId: catalogIdSchema, page: reviewPageSchema }).strict().parse(reviewQuery(req));
    return NextResponse.json({ success: true, ...await readPublicReviews(input.productId, input.page) }, { headers: reviewPrivateHeaders });
  } catch (error) { return reviewFailure(error); }
}
