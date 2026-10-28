import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CheckoutUnavailable, startStripeCheckout } from "@/lib/stripe/order-checkout";

const requestSchema = z.object({ orderId: z.string().uuid(), checkoutToken: z.string().regex(/^[a-f0-9]{64}$/) });

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Invalid checkout request." }, { status: 400 });
  try {
    const { orderId, checkoutToken } = parsed.data;
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { checkoutTokenHash: true } });
    const supplied = createHash("sha256").update(checkoutToken).digest();
    const stored = Buffer.from(order?.checkoutTokenHash ?? "", "hex");
    if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) return NextResponse.json({ success: false, message: "Order is not available for checkout." }, { status: 404 });
    const base = new URL(process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin);
    if (process.env.NODE_ENV === "production" && (!process.env.NEXT_PUBLIC_APP_URL || base.protocol !== "https:")) throw new Error("Configure an HTTPS application origin");
    const session = await startStripeCheckout(orderId, base.origin);
    return NextResponse.json({ success: true, url: session.url, sessionId: session.id, paid: session.payment_status === "paid" });
  } catch (error) {
    if (error instanceof CheckoutUnavailable) return NextResponse.json({ success: false, code: "CHECKOUT_CLOSED", message: error.message }, { status: 409 });
    console.error("Stripe checkout could not be confirmed; reservation retained");
    return NextResponse.json({ success: false, message: "Unable to confirm card checkout. Retry this order shortly." }, { status: 503 });
  }
}
