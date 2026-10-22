import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const milestones = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const limit = await rateLimit(getClientIp(req.headers), 10, 60, "order-tracking");
  if (!limit.success) {
    return NextResponse.json(
      { success: false, message: "Too many tracking attempts. Try again shortly." },
      { status: 429 }
    );
  }

  const { orderId } = await params;
  const phone = new URL(req.url).searchParams.get("phone")?.replace(/\D/g, "");
  if (!orderId || !phone) {
    return NextResponse.json(
      { success: false, message: "Order ID and registered phone number are required." },
      { status: 400 }
    );
  }

  try {
    const order = await prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { trackingNumber: orderId }] },
      select: {
        id: true,
        status: true,
        createdAt: true,
        total: true,
        shippingPhone: true,
        items: { select: { quantity: true } },
      },
    });

    if (!order || order.shippingPhone?.replace(/\D/g, "") !== phone) {
      return NextResponse.json(
        { success: false, message: "No order matched those details." },
        { status: 404 }
      );
    }

    const status = order.status.toUpperCase();
    const activeIndex = milestones.indexOf(status as (typeof milestones)[number]);
    const timeline = milestones.map((step, index) => ({
      step: step === "PENDING" ? "Order Placed" : step.charAt(0) + step.slice(1).toLowerCase(),
      date: index === 0 ? order.createdAt.toISOString() : "Not updated",
      done: activeIndex >= index,
      current: activeIndex === index,
    }));

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        total: Number(order.total),
        itemsCount: order.items.reduce((count, item) => count + item.quantity, 0),
        timeline:
          status === "CANCELLED"
            ? [{ step: "Order Cancelled", date: order.createdAt.toISOString(), done: true, current: true }]
            : timeline,
      },
    });
  } catch (error) {
    console.error("Order tracking lookup failed:", error);
    return NextResponse.json(
      { success: false, message: "Unable to retrieve tracking details right now." },
      { status: 500 }
    );
  }
}
