import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { netCollectedRevenue } from "@/lib/financial-metrics";

export async function GET() {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  try {
    const [users, products, orders, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.order.count(),
      netCollectedRevenue(),
    ]);
    return NextResponse.json({
      success: true,
      metrics: {
        users,
        products,
        orders,
        paidRevenue: revenue,
      },
    });
  } catch (error) {
    console.error("Analytics lookup failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load analytics." }, { status: 500 });
  }
}
