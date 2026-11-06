import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, code: "CUSTOMER_PORTAL_UNSUPPORTED", message: "This marketplace uses one-time order payments. Manage orders in your account or contact support about a refund.", ordersPath: "/user/orders", supportPath: "/contact" },
    { status: 410, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }
  );
}
