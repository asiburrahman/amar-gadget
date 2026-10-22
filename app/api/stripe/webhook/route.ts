import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe/stripe";

async function markOrderPaid(
  orderId: string,
  paymentIntentId: string | null,
  amountPaid: number,
  currency: string
) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, total: true, paymentStatus: true },
    });
    if (!order) throw new Error(`Stripe order ${orderId} was not found.`);
    if (currency.toLowerCase() !== "bdt") {
      throw new Error(`Stripe currency does not match order ${orderId}.`);
    }
    if (Math.round(Number(order.total) * 100) !== amountPaid) {
      throw new Error(`Stripe amount does not match order ${orderId}.`);
    }
    if (order.paymentStatus === "PAID") return;
    if (order.paymentStatus !== "UNPAID") {
      throw new Error(`Stripe payment cannot be applied to order ${orderId} in its current state.`);
    }

    const updated = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING", paymentStatus: "UNPAID" },
      data: {
        paymentStatus: "PAID",
        status: "PROCESSING",
        paymentIntentId,
      },
    });
    if (updated.count !== 1) {
      const current = await tx.order.findUnique({
        where: { id: order.id },
        select: { paymentStatus: true },
      });
      if (current?.paymentStatus === "PAID") return;
      throw new Error(`Stripe order ${orderId} is no longer awaiting payment.`);
    }
  });
}

async function cancelExpiredOrder(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { productId: true, quantity: true } } },
    });
    if (!order || order.paymentStatus !== "UNPAID" || order.status !== "PENDING") return;

    const updated = await tx.order.updateMany({
      where: { id: orderId, paymentStatus: "UNPAID", status: "PENDING" },
      data: { status: "CANCELLED", paymentStatus: "FAILED" },
    });
    if (updated.count !== 1) return;

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
  });
}

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    console.error("Stripe server configuration variables missing.");
    return NextResponse.json({ error: "Stripe configuration error" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid" && session.metadata?.orderId && session.amount_total !== null) {
        await markOrderPaid(
          session.metadata.orderId,
          typeof session.payment_intent === "string" ? session.payment_intent : null,
          session.amount_total,
          session.currency ?? ""
        );
      }
    } else if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      if (paymentIntent.metadata.orderId) {
        await markOrderPaid(
          paymentIntent.metadata.orderId,
          paymentIntent.id,
          paymentIntent.amount_received,
          paymentIntent.currency
        );
      }
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.orderId) await cancelExpiredOrder(session.metadata.orderId);
    } else if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.orderId) await cancelExpiredOrder(session.metadata.orderId);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
