import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrderById } from "@/server/actions/order/order-actions";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

// Lives under the confirmation path so the original scoped HttpOnly guest
// cookie is sent. No address, phone or capability is placed in the URL.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const limit = await rateLimit(getClientIp(req.headers), 30, 60, "order-confirmation");
    if (!limit.success) return NextResponse.json({ message: "Too many requests. Please retry shortly." }, { status: 429, headers });
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ message: "Order not found." }, { status: 404, headers });
    const result = await getOrderById(id);
    if (!result.success || !result.data) return NextResponse.json({ message: result.code === "ORDER_UNAVAILABLE" ? "Order details are temporarily unavailable. Please retry." : "Order not found or access expired." }, { status: result.code === "ORDER_UNAVAILABLE" ? 503 : 404, headers });
    return NextResponse.json({ order: result.data }, { headers });
  } catch {
    return NextResponse.json({ message: "Order details are temporarily unavailable. Please retry." }, { status: 503, headers });
  }
}
