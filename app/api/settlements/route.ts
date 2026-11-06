import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, limitAccountIp, limitAccountIdentity, readAccountJson } from "@/lib/account-request";
import { SettlementError } from "@/lib/settlement-policy";
import { readSellerSettlement, mutateSellerSettlement } from "@/lib/seller-settlement";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function actor(request: Request, write = false) {
  await limitAccountIp(request, write ? "settlement-write" : "settlement-read", write ? 40 : 120);
  const current = await getCurrentUserWithRole(write ? ["ADMIN"] : ["MEMBER", "ADMIN"]);
  if (!current) throw new SettlementError("Current settlement account access is required.", "SETTLEMENT_FORBIDDEN", 403);
  if (request.headers.get("x-settlement-owner") !== current.id) throw new SettlementError("The active account changed. Reload settlement before continuing.", "SETTLEMENT_OWNER_CHANGED");
  await limitAccountIdentity(current.id, write ? "settlement-write" : "settlement-read", write ? 20 : 120, 60); return current;
}
function failure(error: unknown) {
  if (error instanceof SettlementError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof SettlementError ? error.code : "SETTLEMENT_REQUEST" }, { status: error.status, headers: { ...headers, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the settlement fields, amount, observed revision, reason and explicit confirmation.", code: "SETTLEMENT_REQUEST" }, { status: 400, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ success: false, message: "This financial identity or external reference is already recorded. Reload the saved state before deciding again.", code: "SETTLEMENT_CONFLICT" }, { status: 409, headers });
  console.error("Settlement request unavailable; private financial, provider and database details were not logged.");
  return NextResponse.json({ success: false, message: "Settlement could not be confirmed. Reload the saved wallet and original request receipt before retrying.", code: "SETTLEMENT_UNAVAILABLE" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const current = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new SettlementError("Use each settlement query field once.", "SETTLEMENT_REQUEST", 400);
    return NextResponse.json({ success: true, ...await readSellerSettlement(current, Object.fromEntries(params)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await actor(request, true), result = await mutateSellerSettlement(current, await readAccountJson(request));
    try { for (const path of ["/admin/settlements", "/member/earnings", "/member/payouts", "/member/analytics", "/member/dashboard"]) revalidatePath(path); }
    catch { console.warn("Settlement mutation committed; private view cache refresh deferred."); }
    return NextResponse.json({ success: true, ownerId: current.id, ...result }, { headers });
  } catch (error) { return failure(error); }
}
