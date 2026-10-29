import { NextResponse } from "next/server";
import { AccountRequestError, limitAccountIp, readAccountJson } from "@/lib/account-request";
import { wishlistIdsSchema } from "@/lib/validations/wishlist";
import { resolveWishlistProducts } from "@/lib/wishlist";
import { z } from "zod";
const schema = z.object({ productIds: wishlistIdsSchema }).strict();
export async function POST(request: Request) {
  try {
    await limitAccountIp(request, "guest-wishlist-resolve", 60);
    const parsed = schema.safeParse(await readAccountJson(request));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Provide up to 200 distinct product IDs." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ success: true, items: await resolveWishlistProducts(parsed.data.productIds) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof AccountRequestError ? error.message : "Wishlist catalog data is unavailable." }, { status: error instanceof AccountRequestError ? error.status : 503, headers: { "Cache-Control": "no-store", ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  }
}
