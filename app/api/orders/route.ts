import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { readCustomerOrders } from "@/lib/customer-orders-read";
import { customerOrdersQuerySchema } from "@/lib/validations/collection-query";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { unavailableResponse } from "@/lib/http-unavailable";

export async function GET(request: Request) {
  const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401, headers: privateHeaders });
    const params = new URL(request.url).searchParams;
    const raw = Object.fromEntries(Array.from(new Set(params.keys())).map((key) => [key, params.getAll(key).length === 1 ? params.get(key) : params.getAll(key)]));
    const parsed = customerOrdersQuerySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ success: false, message: "Invalid order search, status or page." }, { status: 400, headers: privateHeaders });
    const { orders, counts, total, page, pageSize, totalPages } = await readCustomerOrders(user, parsed.data);
    return NextResponse.json({
      success: true,
      pagination: { total, page, pageSize, totalPages }, counts,
      orders: orders.map((order) => ({
        id: order.id, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
        trackingNumber: order.trackingNumber, createdAt: order.createdAt,
        total: Number(order.total),
        items: order.items.map(({ quantity }) => ({ quantity })),
        itemsCount: order.items.reduce((count, item) => count + item.quantity, 0),
      })),
    }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof ReadAccessError) return NextResponse.json({ success: false, message: "Sign in again to load your orders." }, { status: 401, headers: privateHeaders });
    if (error instanceof ReadPageError) return NextResponse.json({ success: false, message: error.message }, { status: 400, headers: privateHeaders });
    return unavailableResponse("customer.orders.api", error, "Order history is temporarily unavailable. Try again shortly.");
  }
}
