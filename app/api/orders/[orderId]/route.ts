import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { orderHistoryEntry } from "@/lib/order-history";

export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const limit = await rateLimit(getClientIp(req.headers), 10, 60, "order-tracking");
    if (!limit.success) return NextResponse.json({ success: false, message: "Too many tracking attempts. Try again shortly." }, { status: 429, headers });
    const { orderId } = await params;
    const query = new URL(req.url).searchParams;
    const phone = query.get("phone")?.replace(/\D/g, "") ?? "";
    const cursor = query.get("cursor");
    if (!orderId || orderId.length > 120 || !/^\d{10,15}$/.test(phone) || (cursor && !z.string().uuid().safeParse(cursor).success)) {
      return NextResponse.json({ success: false, message: "Enter an order ID/tracking code and the phone number used at checkout." }, { status: 400, headers });
    }
    const order = await prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { trackingNumber: orderId }] },
      select: { id: true, status: true, paymentStatus: true, createdAt: true, total: true, shippingPhone: true, shippingCarrier: true, shipmentTrackingNumber: true, items: { select: { quantity: true } } },
    });
    if (!order || order.shippingPhone?.replace(/\D/g, "") !== phone) return NextResponse.json({ success: false, message: "No order matched those details." }, { status: 404, headers });
    if (cursor && !(await prisma.orderEvent.findFirst({ where: { id: cursor, orderId: order.id }, select: { id: true } }))) return NextResponse.json({ success: false, message: "History position not found. Refresh tracking." }, { status: 404, headers });
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { sequence: "asc" }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const page = events.slice(0, 50);
    const nextCursor = events.length > 50 ? page[page.length - 1].id : null;
    return NextResponse.json({ success: true, order: {
      id: order.id, status: order.status, paymentStatus: order.paymentStatus, createdAt: order.createdAt.toISOString(), total: Number(order.total),
      carrier: order.shippingCarrier, shipmentTrackingNumber: order.shipmentTrackingNumber,
      itemsCount: order.items.reduce((count, item) => count + item.quantity, 0),
      timeline: page.map((event, index) => ({ ...orderHistoryEntry(event), done: true, current: !nextCursor && index === page.length - 1 })), nextCursor,
    } }, { headers });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to retrieve tracking details right now." }, { status: 503, headers });
  }
}
