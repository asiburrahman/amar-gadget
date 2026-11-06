import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/stripe";
import { applyStripeSession, confirmStripePayment, releaseReservation } from "@/lib/checkout-reservations";
import { readStripeSecret, readStripeWebhookSecret } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { handleRefundWebhook, handleChargeRefundWebhook, handleDisputeWebhook } from "@/lib/stripe/refunds";
import { invalidateRefundPages } from "@/lib/refund-request";

export async function POST(req: Request) {
  let webhookSecret: string;
  try { readStripeSecret(); webhookSecret = readStripeWebhookSecret(); }
  catch { return NextResponse.json({ error: "Stripe configuration error" }, { status: 503 }); }
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") || "", webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const financialTypes = ["refund.created", "refund.updated", "refund.failed", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated"];
    if (financialTypes.includes(event.type)) {
      if (await prisma.financialWebhookReceipt.findUnique({ where: { id: event.id }, select: { id: true } })) return NextResponse.json({ received: true });
      const result = event.type.startsWith("refund.") ? await handleRefundWebhook(event.data.object as Stripe.Refund) : event.type === "charge.refunded" ? await handleChargeRefundWebhook(event.data.object as Stripe.Charge) : await handleDisputeWebhook(event.data.object as Stripe.Dispute);
      if (result?.orderId) invalidateRefundPages(result.orderId);
      // A competing worker owns the durable attempt. Its next check remains
      // scheduled; do not label this webhook fully reconciled while it is busy.
      if (!result?.deferred) await prisma.financialWebhookReceipt.createMany({ data: [{ id: event.id, kind: event.type, createdAt: new Date() }], skipDuplicates: true });
      return NextResponse.json({ received: true });
    }
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.expired":
        await applyStripeSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.orderId) await releaseReservation(session.metadata.orderId, { expiredSessionId: session.id });
        break;
      }
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata.orderId) await confirmStripePayment(intent.metadata.orderId, intent.id, intent.amount_received, intent.currency);
        break;
      }
    }
    return NextResponse.json({ received: true });
  } catch {
    console.error("Stripe event reconciliation failed", { eventId: event.id, type: event.type });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
