import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe/stripe";
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";

export const INITIAL_RESERVATION_MS = 15 * 60_000;
export const STRIPE_RESERVATION_MS = 31 * 60_000;

export async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
}

/** Release stock only with positive evidence that no payment can complete. */
export async function releaseReservation(
  orderId: string,
  evidence: { noSessionBefore: Date } | { expiredSessionId: string },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.paymentMethod !== "STRIPE" || order.status !== "PENDING" || order.paymentStatus !== "UNPAID") return false;
    if ("noSessionBefore" in evidence) {
      if (order.stripeSessionRequestedAt || !order.reservationExpiresAt || order.reservationExpiresAt > evidence.noSessionBefore) return false;
    } else {
      if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== evidence.expiredSessionId) throw new Error("Stripe session mismatch");
    }
    await tx.order.update({ where: { id: orderId }, data: {
      status: "CANCELLED", paymentStatus: "FAILED", reservationNextCheckAt: null,
      reservationReviewReason: null,
      ...("expiredSessionId" in evidence ? { stripeCheckoutSessionId: evidence.expiredSessionId } : {}),
    } });
    for (const item of [...order.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    }
    return true;
  });
}

export async function confirmStripePayment(orderId: string, intentId: string | null, amount: number, currency: string, sessionId?: string) {
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.paymentMethod !== "STRIPE" || currency.toLowerCase() !== "bdt" || Math.round(Number(order.total) * 100) !== amount) throw new Error("Stripe order amount/currency/method mismatch");
    if (sessionId && order.stripeCheckoutSessionId && sessionId !== order.stripeCheckoutSessionId) throw new Error("Stripe session mismatch");
    if (order.paymentStatus === "PAID") return;
    const late = order.status === "CANCELLED" || order.paymentStatus === "FAILED";
    await tx.order.update({ where: { id: orderId }, data: {
      paymentStatus: "PAID", paymentIntentId: intentId,
      ...(sessionId ? { stripeCheckoutSessionId: sessionId } : {}),
      status: late ? "CANCELLED" : "PROCESSING",
      reservationNextCheckAt: null,
      reservationReviewReason: late ? "LATE_PAYMENT_REQUIRES_REFUND" : null,
    } });
    // A late payment is recorded for operator reconciliation, never fulfilled
    // against inventory already returned to sale. Refund operations are AUD-015.
    if (late) console.error("Late Stripe payment requires operator refund review", { orderId });
  });
}

export async function applyStripeSession(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) throw new Error("Missing Stripe order metadata");
  if (session.payment_status === "paid") {
    if (session.amount_total === null) throw new Error("Missing Stripe payment amount");
    await confirmStripePayment(orderId, typeof session.payment_intent === "string" ? session.payment_intent : null, session.amount_total, session.currency ?? "", session.id);
    return "paid" as const;
  }
  if (session.status === "expired") {
    return await releaseReservation(orderId, { expiredSessionId: session.id }) ? "released" as const : "unchanged" as const;
  }
  return "waiting" as const;
}

/** Safe for overlapping workers: every release/payment write locks the order. */
export async function reconcileReservation(orderId: string, now = new Date(), force = false) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paymentMethod !== "STRIPE" || order.status !== "PENDING" || order.paymentStatus !== "UNPAID") return "unchanged" as const;
  if (!force && (!order.reservationExpiresAt || order.reservationExpiresAt > now)) return "unchanged" as const;
  if (!order.stripeSessionRequestedAt) {
    const cutoff = force ? order.reservationExpiresAt ?? now : now;
    return await releaseReservation(orderId, { noSessionBefore: cutoff }) ? "released" as const : "unchanged" as const;
  }
  if (!order.stripeCheckoutSessionId) {
    // A timeout could mean Stripe created a session but its response was lost.
    // Signed webhooks can resolve it; otherwise require provider reconciliation.
    await prisma.order.updateMany({ where: { id: orderId, status: "PENDING", paymentStatus: "UNPAID", stripeCheckoutSessionId: null }, data: {
      reservationReviewReason: order.reservationReviewReason ?? "SESSION_CREATION_UNCERTAIN",
      reservationNextCheckAt: new Date(now.getTime() + 5 * 60_000),
    } });
    return "review" as const;
  }
  const stripe = getStripe({ timeout: 5_000, maxNetworkRetries: 0 });
  let session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  if (session.metadata?.orderId !== orderId) throw new Error("Stripe session metadata mismatch");
  if (session.status === "open" && session.payment_status !== "paid") {
    try { session = await stripe.checkout.sessions.expire(session.id); }
    catch {
      // Payment may have completed between retrieve and expire.
      session = await stripe.checkout.sessions.retrieve(session.id);
    }
  }
  const result = await applyStripeSession(session);
  if (result === "waiting") {
    await prisma.order.updateMany({ where: { id: orderId, status: "PENDING", paymentStatus: "UNPAID" }, data: {
      reservationNextCheckAt: new Date(now.getTime() + 5 * 60_000), reservationReviewReason: "PAYMENT_PENDING_PROVIDER",
    } });
  }
  return result;
}

export async function sweepReservations(limit = 50, now = new Date()) {
  const due = await prisma.order.findMany({
    where: { paymentMethod: "STRIPE", status: "PENDING", paymentStatus: "UNPAID", reservationNextCheckAt: { lte: now } },
    select: { id: true }, orderBy: { reservationNextCheckAt: "asc" }, take: Math.min(100, Math.max(1, limit)),
  });
  const summary = { checked: 0, released: 0, paid: 0, review: 0, waiting: 0, unchanged: 0, errors: 0 };
  const deadline = Date.now() + 20_000;
  for (const order of due) {
    if (Date.now() >= deadline) break;
    summary.checked++;
    try { summary[await reconcileReservation(order.id, now)]++; }
    catch {
      summary.errors++;
      await prisma.order.updateMany({ where: { id: order.id, status: "PENDING", paymentStatus: "UNPAID" }, data: {
        reservationNextCheckAt: new Date(now.getTime() + 5 * 60_000), reservationReviewReason: "PROVIDER_RECONCILIATION_FAILED",
      } });
      console.error("Reservation reconciliation failed; inventory retained", { orderId: order.id });
    }
  }
  return summary;
}
