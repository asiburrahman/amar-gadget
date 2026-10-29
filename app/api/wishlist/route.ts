import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, limitAccountIp, limitAccountIdentity, readAccountJson } from "@/lib/account-request";
import { addressPageSchema } from "@/lib/validations/address";
import { wishlistAddSchema, wishlistDeleteSchema } from "@/lib/validations/wishlist";
import { WishlistError, readWishlist, addWishlistProducts, removeWishlistProducts } from "@/lib/wishlist";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  const operation = write ? "wishlist-write" : "wishlist-read";
  await limitAccountIp(request, operation, write ? 60 : 120);
  const user = await getCurrentUser();
  if (!user) throw new WishlistError("Sign in to sync your wishlist.", 401, "ACCOUNT_CHANGED");
  if (request.headers.get("x-wishlist-owner") !== user.id) throw new WishlistError("The active account changed. Refresh your session.", 409, "ACCOUNT_CHANGED");
  await limitAccountIdentity(user.id, operation, write ? 30 : 120, 60); return user;
}
function failure(error: unknown) {
  if (error instanceof WishlistError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof WishlistError ? error.code : "INVALID_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  console.error("Wishlist request unavailable; private details were not logged.");
  return NextResponse.json({ success: false, message: "Wishlist is temporarily unavailable. Refresh before retrying.", code: "UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const user = await actor(request), query = new URL(request.url).searchParams, page = addressPageSchema.safeParse(query.get("page"));
    if (!page.success || query.getAll("page").length > 1 || [...query.keys()].some((key) => key !== "page")) throw new WishlistError("Invalid wishlist page.", 400, "INVALID_REQUEST");
    return NextResponse.json({ success: true, ...await readWishlist(user, page.data) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await actor(request, true), parsed = wishlistAddSchema.safeParse(await readAccountJson(request));
    if (!parsed.success) throw new WishlistError("Provide up to 200 distinct product IDs.", 400, "INVALID_REQUEST");
    return NextResponse.json({ success: true, ...await addWishlistProducts(user, parsed.data.productIds, parsed.data.merge) }, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const user = await actor(request, true), parsed = wishlistDeleteSchema.safeParse(await readAccountJson(request));
    if (!parsed.success) throw new WishlistError("Provide product IDs or the current revision to clear.", 400, "INVALID_REQUEST");
    return NextResponse.json({ success: true, ...await removeWishlistProducts(user, parsed.data) }, { headers });
  } catch (error) { return failure(error); }
}
