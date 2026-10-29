import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/stripe";
import { applyStripeSession, confirmStripePayment, releaseReservation } from "@/lib/checkout-reservations";
import { readStripeSecret, readStripeWebhookSecret } from "@/config/runtime";

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
