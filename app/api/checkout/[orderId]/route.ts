import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { applyStripeSession, reconcileReservation } from "@/lib/checkout-reservations";
import { CheckoutUnavailable, startStripeCheckout } from "@/lib/stripe/order-checkout";
import { getStripe } from "@/lib/stripe/stripe";
import { readApplicationOrigin } from "@/config/runtime";
import { acknowledgeGuestCart } from "@/lib/cart-checkout";
import { CartError } from "@/lib/cart";
import { customerShipmentSelect, customerShipment } from "@/lib/fulfillments";

type Context = { params: Promise<{ orderId: string }> };
async function authorizedOrder(req: Request, context: Context) {
  const limit = await rateLimit(getClientIp(req.headers), 30, 60, "checkout-resume");
  if (!limit.success) return NextResponse.json({ message: "Too many requests. Please wait a minute." }, { status: 429 });
  const { orderId } = await context.params;
  if (!z.string().uuid().safeParse(orderId).success) return NextResponse.json({ message: "Checkout not found." }, { status: 404 });
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { fulfillments: { where: { items: { some: {} } }, orderBy: { id: "asc" }, select: customerShipmentSelect }, items: { include: { product: { select: { name: true } } } } } });
  const user = await getCurrentUser();
  const token = (await cookies()).get("checkout_resume_token")?.value;
  const candidate = createHash("sha256").update(token ?? "").digest();
  const stored = Buffer.from(order?.checkoutTokenHash ?? "", "hex");
  const capability = Boolean(token) && candidate.length === stored.length && timingSafeEqual(candidate, stored);
  const allowed = user ? user.id === order?.userId || user.role.toUpperCase() === "ADMIN" : capability;
  if (!order || !allowed) return NextResponse.json({ message: "Checkout not found or access expired. Use the original checkout account or browser." }, { status: 404 });
  return order;
}

export async function GET(req: Request, context: Context) {
  try {
    const order = await authorizedOrder(req, context);
    if (order instanceof Response) return order;
    return NextResponse.json({ order: {
      id: order.id, total: Number(order.total), status: order.status, paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod, shippingAddress: order.shippingAddress,
      reservationExpiresAt: order.reservationExpiresAt?.toISOString() ?? null,
      needsReview: Boolean(order.reservationReviewReason),
      cartSnapshot: order.cartSnapshot,
      fulfillments: order.fulfillments.map(customerShipment),
      items: order.items.map((item) => ({ productId: item.productId, name: item.product.name, quantity: item.quantity, price: Number(item.price) })),
    } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ message: "Unable to load checkout. Please retry." }, { status: 503 }); }
}

export async function POST(req: Request, context: Context) {
  try {
    const order = await authorizedOrder(req, context);
    if (order instanceof Response) return order;
    const input = z.object({ action: z.enum(["pay", "cancel", "refresh", "ack-cart"]) }).safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ message: "Invalid checkout action." }, { status: 400 });
    if (input.data.action === "ack-cart") {
      try {
        await prisma.$transaction((tx) => acknowledgeGuestCart(tx, order.id));
        return NextResponse.json({ cartAcknowledged: true }, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) {
        if (error instanceof CartError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
        throw error;
      }
    }
    if (order.paymentStatus === "PAID") return NextResponse.json({ paid: true, cancelled: order.status === "CANCELLED" });
    if (input.data.action === "cancel") {
      const result = await reconcileReservation(order.id, new Date(), true);
      if (result === "paid") {
        const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
        return NextResponse.json({ paid: true, cancelled: current.status === "CANCELLED" });
      }
      if (result !== "released" && order.status !== "CANCELLED") return NextResponse.json({ message: "Payment state is not confirmed. Your reservation is retained; refresh or contact support." }, { status: 409 });
      return NextResponse.json({ cancelled: true });
    }
    if (input.data.action === "refresh") {
      if (order.stripeCheckoutSessionId) await applyStripeSession(await getStripe().checkout.sessions.retrieve(order.stripeCheckoutSessionId));
      return NextResponse.json({ refreshed: true });
    }
    const session = await startStripeCheckout(order.id, readApplicationOrigin());
    return NextResponse.json({ url: session.url, paid: session.payment_status === "paid", waiting: session.status === "complete" });
  } catch (error) {
    if (error instanceof CheckoutUnavailable) return NextResponse.json({ code: error.code, message: error.message }, { status: 409 });
    return NextResponse.json({ message: "Unable to confirm payment right now. Retry this order; your cart is retained." }, { status: 503 });
  }
}
