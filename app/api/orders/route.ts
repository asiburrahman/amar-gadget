import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  try {
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        trackingNumber: true,
        createdAt: true,
        total: true,
        items: { select: { quantity: true } },
      },
    });
    return NextResponse.json({
      success: true,
      orders: orders.map((order) => ({
        ...order,
        total: Number(order.total),
        itemsCount: order.items.reduce((count, item) => count + item.quantity, 0),
      })),
    });
  } catch (error) {
    console.error("Customer order listing failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load orders." }, { status: 500 });
  }
}
