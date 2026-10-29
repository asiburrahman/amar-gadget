import { NextResponse } from "next/server";
import { getRecentProducts } from "@/lib/recent-products";
import { recentIdsSchema } from "@/lib/validations/recent-history";
import { limitAccountIp, AccountRequestError } from "@/lib/account-request";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const parsed = recentIdsSchema.safeParse(new URL(request.url).searchParams.getAll("product"));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Choose up to twenty distinct product IDs." }, { status: 400, headers });
  try {
    await limitAccountIp(request, "recent-products", 60);
    return NextResponse.json({ success: true, products: await getRecentProducts(parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: { ...headers, "Retry-After": String(error.retryAfter ?? 60) } });
    return NextResponse.json({ success: false, message: "Recent products are temporarily unavailable." }, { status: 503, headers });
  }
}
