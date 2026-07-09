import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    console.error("❌ Stripe server configuration variables missing!");
    return NextResponse.json({ error: "Stripe configuration error" }, { status: 500 });
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: "2025-01-27" as any,
  });

  const body = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`⚠️ Webhook signature verification failed:`, err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    // Retrieve order by paymentIntentId
    const existingOrder = await prisma.order.findFirst({
      where: { paymentIntentId: paymentIntent.id },
    });

    // Handle race condition: Webhook arrives before client order creation transaction commits.
    // Returning 404 tells Stripe the resource is missing, prompting automatic retries.
    if (!existingOrder) {
      console.warn(`⚠️ Order not found for paymentIntent: ${paymentIntent.id}. Triggering Stripe retry.`);
      return NextResponse.json({ error: "Order not found yet, retrying..." }, { status: 404 });
    }

    if (existingOrder.status !== "PAID") {
      await prisma.order.update({
        where: { id: existingOrder.id },
        data: { status: "PAID" },
      });
    }
  }

  return NextResponse.json({ received: true });
}