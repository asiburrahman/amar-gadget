import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { AccountAdminError } from "@/lib/account-administration";
import { readAdministratorReport, administratorReportCsv } from "@/lib/admin-reporting";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  try {
    await limitAccountIp(request, "admin-report", 60);
    const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) throw new AccountAdminError("Administrator access is required.", "FORBIDDEN", 403);
    if (request.headers.get("x-reports-owner") !== actor.id) throw new AccountAdminError("The active account changed. Reload the reports area.", "ADMIN_OWNER_CHANGED");
    await limitAccountIdentity(actor.id, "admin-report", 30, 60);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new AccountAdminError("Use each report filter once.", "ADMIN_REQUEST", 400);
    const report = await readAdministratorReport(actor, Object.fromEntries(params));
    if (report.filters.format === "csv") return new Response(administratorReportCsv(report), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="amar-gadget-orders-${report.filters.from}-${report.filters.to}.csv"` } });
    return NextResponse.json({ success: true, ...report }, { headers });
  } catch (error) {
    if (error instanceof AccountAdminError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof AccountAdminError ? error.code : "ADMIN_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Use valid filters and both dates, spanning at most 366 inclusive days.", code: "ADMIN_REQUEST" }, { status: 400, headers });
    console.error("Administrator report unavailable; private filters and database details were not logged.");
    return NextResponse.json({ success: false, message: "Reports are temporarily unavailable. No export was confirmed.", code: "ADMIN_REPORT_UNAVAILABLE" }, { status: 503, headers });
  }
}
