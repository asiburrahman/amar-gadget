import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe/stripe";
import { STORE_CURRENCY } from "@/lib/currency";
import { applyStripeSession, lockOrder, STRIPE_RESERVATION_MS } from "@/lib/checkout-reservations";

export class CheckoutUnavailable extends Error {
  constructor(message: string, readonly code = "CHECKOUT_CLOSED") { super(message); }
}

/** Durable request parameters make provider retries safe after lost responses. */
export async function startStripeCheckout(orderId: string, origin: string) {
  const stripe = getStripe();
  const order = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (current.paymentMethod !== "STRIPE" || current.status !== "PENDING" || current.paymentStatus !== "UNPAID") throw new CheckoutUnavailable("This order is not awaiting payment.");
    if (current.stripeSessionRequestedAt) {
      if (!current.stripeCheckoutOrigin || !current.reservationExpiresAt) throw new CheckoutUnavailable("This payment needs support review before retrying.", "CHECKOUT_REVIEW");
      return current;
    }
    if (!current.reservationExpiresAt || current.reservationExpiresAt <= new Date()) throw new CheckoutUnavailable("This checkout reservation has expired. Start a new checkout.");
    const deadline = new Date(Math.floor((Date.now() + STRIPE_RESERVATION_MS) / 1000) * 1000);
    return tx.order.update({ where: { id: orderId }, data: {
      stripeSessionRequestedAt: new Date(), stripeCheckoutOrigin: origin,
      stripeCheckoutVersion: 2,
      reservationExpiresAt: deadline, reservationNextCheckAt: deadline,
    } });
  });
  const session = order.stripeCheckoutSessionId
    ? await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId)
    : await stripe.checkout.sessions.create({
      payment_method_types: ["card"], mode: "payment",
      line_items: [{ price_data: { currency: STORE_CURRENCY.toLowerCase(), product_data: { name: `Amar Gadget order ${order.id}` }, unit_amount: Math.round(Number(order.total) * 100) }, quantity: 1 }],
      success_url: `${order.stripeCheckoutOrigin}/order-success/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${order.stripeCheckoutOrigin}/checkout${order.stripeCheckoutVersion >= 2 ? `?resume=${order.id}` : ""}`,
      expires_at: Math.floor(order.reservationExpiresAt!.getTime() / 1000),
      metadata: { orderId: order.id }, payment_intent_data: { metadata: { orderId: order.id } },
    }, { idempotencyKey: `checkout-${order.id}` });
  if (session.metadata?.orderId !== orderId) throw new Error("Stripe session metadata mismatch");
  await prisma.order.updateMany({ where: { id: orderId, OR: [{ stripeCheckoutSessionId: null }, { stripeCheckoutSessionId: session.id }] }, data: { stripeCheckoutSessionId: session.id } });
  const state = await applyStripeSession(session);
  if (state === "released" || session.status === "expired") throw new CheckoutUnavailable("This checkout has expired. Start a new checkout.");
  return session;
}
