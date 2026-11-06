import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, limitAccountIp, limitAccountIdentity, readAccountJson } from "@/lib/account-request";
import { CartError, readAccountCart, mutateAccountCart } from "@/lib/cart";
import { cartMutationSchema } from "@/lib/validations/cart";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
async function actor(request: Request, write = false) {
  const operation = write ? "account-cart-write" : "account-cart-read";
  await limitAccountIp(request, operation, write ? 90 : 120);
  const user = await getCurrentUser();
  if (!user) throw new CartError("Sign in to load your account cart.", "CART_ACCOUNT_CHANGED", 401);
  if (request.headers.get("x-cart-owner") !== user.id) throw new CartError("The active account changed. Refresh your session.", "CART_ACCOUNT_CHANGED");
  await limitAccountIdentity(user.id, operation, write ? 60 : 120, 60);
  return user;
}
function failure(error: unknown) {
  if (error instanceof CartError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof CartError ? error.code : "INVALID_REQUEST" }, { status: error.status, headers: { ...privateHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  console.error("Cart request unavailable; private details were not logged.");
  return NextResponse.json({ success: false, message: "Cart is unavailable. Refresh before retrying an uncertain change.", code: "CART_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
}
export async function GET(request: Request) {
  try {
    const user = await actor(request);
    if ([...new URL(request.url).searchParams].length) throw new CartError("Cart does not accept query selectors.", "INVALID_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readAccountCart(user) }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await actor(request, true), parsed = cartMutationSchema.safeParse(await readAccountJson(request));
    if (!parsed.success) throw new CartError("Check the cart change, quantities and current revision.", "INVALID_REQUEST", 400);
    return NextResponse.json({ success: true, ...await mutateAccountCart(user, parsed.data) }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
