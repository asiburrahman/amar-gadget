import { NextResponse } from "next/server";
import { getCurrentUserWithRole } from "@/lib/session";
import { readAdministratorOverview } from "@/lib/admin-reporting";
import { AccountAdminError } from "@/lib/account-administration";
import { AccountRequestError, limitAccountIp, limitAccountIdentity } from "@/lib/account-request";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await limitAccountIp(request, "admin-analytics", 120);
    const actor = await getCurrentUserWithRole(["ADMIN"]);
    if (!actor) throw new AccountAdminError("Administrator access is required.", "FORBIDDEN", 403);
    if (request.headers.get("x-analytics-owner") !== actor.id) throw new AccountAdminError("The active account changed. Reload analytics.", "ADMIN_OWNER_CHANGED");
    if (new URL(request.url).search) throw new AccountAdminError("Use the reports endpoint for date/payment filters.", "ADMIN_REQUEST", 400);
    await limitAccountIdentity(actor.id, "admin-analytics", 120, 60);
    const overview = await readAdministratorOverview(actor);
    return NextResponse.json({
      success: true,
      metrics: {
        users: overview.users,
        products: overview.products,
        orders: overview.orders,
        paidRevenue: overview.paidRevenueCents / 100,
      },
      overview,
    }, { headers });
  } catch (error) {
    if (error instanceof AccountAdminError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    console.error("Administrator analytics unavailable; private database details were not logged.");
    return NextResponse.json({ success: false, message: "Unable to load analytics." }, { status: 503, headers });
  }
}
