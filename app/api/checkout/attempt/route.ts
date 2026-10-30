import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AccountRequestError, limitAccountIp, limitAccountIdentity, readAccountJson } from "@/lib/account-request";
import { catalogIdSchema } from "@/lib/validations/product";
import { cartCheckoutSchema } from "@/lib/validations/cart";
const schema = z.object({ checkoutToken: z.string().regex(/^[a-f0-9]{64}$/), ownerId: catalogIdSchema.nullable(), sourceId: z.string().uuid().nullable() }).strict();
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    await limitAccountIp(request, "checkout-attempt-lookup", 30);
    const parsed = schema.safeParse(await readAccountJson(request, 1024));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Invalid checkout recovery request." }, { status: 400, headers });
    const user = await getCurrentUser(), input = parsed.data;
    if ((user?.id ?? null) !== input.ownerId) return NextResponse.json({ success: false, code: "CART_ACCOUNT_CHANGED", message: "Use the original checkout account or guest session." }, { status: 409, headers });
    const hash = createHash("sha256").update(input.checkoutToken).digest("hex");
    await limitAccountIdentity(hash, "checkout-attempt-lookup", 10, 60);
    const order = await prisma.order.findUnique({ where: { checkoutTokenHash: hash }, select: { id: true, userId: true, status: true, paymentStatus: true, paymentMethod: true, cartSnapshot: true, createdAt: true } });
    const context = cartCheckoutSchema.safeParse(order?.cartSnapshot);
    if (!order || !context.success || context.data.ownerId !== input.ownerId || context.data.sourceId !== input.sourceId || (user && order.userId !== user.id)) return NextResponse.json({ success: false, message: "No confirmed checkout receipt found. Keep the same attempt when retrying." }, { status: 404, headers });
    const response = NextResponse.json({ success: true, order: { id: order.id, status: order.status, paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod, cartSnapshot: context.data, createdAt: order.createdAt.toISOString() } }, { headers });
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 86400 };
    response.cookies.set("order_access_token", input.checkoutToken, { ...options, path: `/order-success/${order.id}` });
    response.cookies.set("checkout_resume_token", input.checkoutToken, { ...options, path: `/api/checkout/${order.id}` });
    return response;
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof AccountRequestError ? error.message : "Unable to verify this checkout attempt. Keep its original session and retry." }, { status: error instanceof AccountRequestError ? error.status : 503, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  }
}
