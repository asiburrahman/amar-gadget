import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, limitAccountIp, limitAccountIdentity } from "@/lib/account-request";
import { ReviewError } from "@/lib/reviews";
import { productPath } from "@/lib/seo/urls";
import type { OwnedReview } from "@/lib/validations/review";
export const reviewPrivateHeaders = { "Cache-Control": "private, no-store" };
export async function reviewActor(request: Request, options: { write?: boolean; role?: "ADMIN" | "MEMBER" } = {}) {
  const operation = options.write ? "review-write" : "review-private-read";
  await limitAccountIp(request, operation, options.write ? 30 : 120);
  const actor = await getCurrentUser();
  if (!actor) throw new ReviewError("Sign in to manage purchase reviews.", "REVIEW_ACCOUNT_CHANGED", 401);
  if (request.headers.get("x-review-owner") !== actor.id) throw new ReviewError("The active account changed. Refresh your session.", "REVIEW_ACCOUNT_CHANGED");
  if (options.role && (actor.role !== options.role || (options.role === "MEMBER" && actor.sellerStatus !== "APPROVED"))) throw new ReviewError("This review operation is not permitted.", "FORBIDDEN", 403);
  await limitAccountIdentity(actor.id, operation, options.write ? 10 : 120, 60);
  return actor;
}
export function reviewQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new ReviewError("Use each review query field once.", "INVALID_REQUEST", 400);
  return Object.fromEntries(params);
}
export function reviewFailure(error: unknown) {
  if (error instanceof ReviewError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof ReviewError ? error.code : "INVALID_REQUEST" }, { status: error.status, headers: { ...reviewPrivateHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the review fields, rating, text length and current revision.", code: "INVALID_REQUEST" }, { status: 400, headers: reviewPrivateHeaders });
  console.error("Review request unavailable; private details were not logged.");
  return NextResponse.json({ success: false, message: "Unable to confirm this review request. Reload its current state before retrying.", code: "REVIEW_UNAVAILABLE" }, { status: 503, headers: reviewPrivateHeaders });
}
/** Cache failure happens after commit; never report a saved review as failed. */
export function invalidateReviewPages(review: OwnedReview) {
  try {
    const path = productPath(review.product.slug, review.product.id);
    revalidatePath(path.length <= 1024 ? path : `/products/${encodeURIComponent(review.product.id)}`);
    revalidatePath("/products"); revalidatePath("/");
  } catch { console.warn("Review saved; catalog cache refresh deferred."); }
}
