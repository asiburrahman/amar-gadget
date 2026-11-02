import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, readAccountJson, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { CouponError, mutateCoupon, readCoupons } from "@/lib/admin-coupons";
import { CheckoutQuoteError } from "@/lib/coupon-policy";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  await limitAccountIp(request, write ? "coupon-write" : "coupon-read", write ? 60 : 120);
  const current = await getCurrentUserWithRole(["ADMIN"]);
  if (!current) throw new CouponError("Administrator access is required.", "FORBIDDEN", 403);
  if (request.headers.get("x-coupon-owner") !== current.id) throw new CouponError("The active account changed. Reload this administrator area.", "COUPON_ACCOUNT_CHANGED");
  await limitAccountIdentity(current.id, write ? "coupon-write" : "coupon-read", write ? 40 : 120, 60);
  return current;
}
function failure(error: unknown) {
  if (error instanceof CouponError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof CouponError ? error.code : "COUPON_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof CheckoutQuoteError) return NextResponse.json({ success: false, message: error.message, code: error.code }, { status: 422, headers });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the coupon fields, money precision, expiry, request identity and revision.", code: "COUPON_REQUEST" }, { status: 400, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ success: false, message: "This coupon code already exists. Reload the saved state and choose another code.", code: "COUPON_CONFLICT" }, { status: 409, headers });
  console.error("Coupon operation unavailable; private request and database details were not logged.");
  return NextResponse.json({ success: false, message: "The change was not confirmed. Reload the saved state and original request receipt before retrying.", code: "COUPON_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const current = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new CouponError("Use each query field once.", "COUPON_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readCoupons(current, Object.fromEntries(params)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await actor(request, true), result = await mutateCoupon(current, await readAccountJson(request, 16_384));
    if (result.kind === "saved") {
      try { for (const path of ["/admin/coupons", "/cart", "/checkout"]) revalidatePath(path); }
      catch { console.warn("Coupon committed; cache refresh deferred."); }
    }
    return NextResponse.json({ success: true, ownerId: current.id, ...result }, { headers });
  } catch (error) { return failure(error); }
}
