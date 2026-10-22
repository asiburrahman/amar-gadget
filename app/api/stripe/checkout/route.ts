import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe/stripe";

const requestSchema = z.object({
  orderId: z.string().uuid(),
  checkoutToken: z.string().length(64),
});

function tokenMatches(token: string, storedHash: string | null) {
  if (!storedHash) return false;
  const providedHash = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return providedHash.length === expectedHash.length && timingSafeEqual(providedHash, expectedHash);
}

async function releaseUnpaidOrder(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { productId: true, quantity: true } } },
    });
    if (!order || order.status !== "PENDING" || order.paymentStatus !== "UNPAID") return;

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING", paymentStatus: "UNPAID" },
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
  let reservedOrderId: string | null = null;
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "Invalid checkout request." }, { status: 400 });
    }

    const { orderId, checkoutToken } = parsed.data;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { select: { name: true } } } } },
    });

    if (
      !order ||
      order.paymentMethod !== "STRIPE" ||
      order.paymentStatus !== "UNPAID" ||
      order.status !== "PENDING" ||
      !tokenMatches(checkoutToken, order.checkoutTokenHash)
    ) {
      return NextResponse.json({ success: false, message: "Order is not available for checkout." }, { status: 404 });
    }
    reservedOrderId = order.id;

    const amountInMinorUnits = Math.round(Number(order.total) * 100);
    if (!Number.isSafeInteger(amountInMinorUnits) || amountInMinorUnits < 100) {
      await releaseUnpaidOrder(order.id);
      reservedOrderId = null;
      return NextResponse.json({ success: false, message: "Order total is not valid for card payment." }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const successUrl = new URL(
      `/order-success/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      appUrl
    ).toString();
    const cancelUrl = new URL("/checkout", appUrl).toString();
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: `Amar Gadget order ${order.id}` },
            unit_amount: amountInMinorUnits,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { orderId: order.id },
      payment_intent_data: { metadata: { orderId: order.id } },
    }, { idempotencyKey: `checkout-${order.id}` });

    return NextResponse.json({ success: true, url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    if (reservedOrderId) {
      try {
        await releaseUnpaidOrder(reservedOrderId);
      } catch (releaseError) {
        console.error("Failed to release inventory for unavailable Stripe checkout:", releaseError);
      }
    }
    return NextResponse.json(
      { success: false, message: "Failed to create Stripe Checkout session." },
      { status: 500 }
    );
  }
}
