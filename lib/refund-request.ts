import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { RefundError } from "@/lib/refund-policy";
export const refundHeaders = { "Cache-Control": "private, no-store" };
export async function refundActor(request: Request, write = false, admin = false) {
  await limitAccountIp(request, write ? "refund-write" : "refund-read", write ? 30 : 120);
  const actor = await getCurrentUser();
  if (!actor) throw new RefundError("Sign in to view the order's refund state.", "REFUND_ACCOUNT_CHANGED", 401);
  if (request.headers.get("x-refund-owner") !== actor.id) throw new RefundError("The account changed. Reload this account area.", "REFUND_ACCOUNT_CHANGED");
  if (admin && actor.role !== "ADMIN") throw new RefundError("Administrator access is required.", "FORBIDDEN", 403);
  await limitAccountIdentity(actor.id, write ? "refund-write" : "refund-read", write ? 12 : 120, 60); return actor;
}
export function refundFailure(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ success: false, message: "This reference or attempt has already been recorded. Reload the saved financial state.", code: "REFUND_REFERENCE_USED" }, { status: 409, headers: refundHeaders });
  if (error instanceof RefundError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof RefundError ? error.code : "REFUND_REQUEST" }, { status: error.status, headers: { ...refundHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the refund fields, quantities and observed revision.", code: "REFUND_REQUEST" }, { status: 400, headers: refundHeaders });
  console.error("Refund request unavailable; financial, provider and customer details were not logged.");
  return NextResponse.json({ success: false, message: "The refund change was not confirmed. Reload its saved state before retrying.", code: "REFUND_UNAVAILABLE" }, { status: 503, headers: refundHeaders });
}
export function invalidateRefundPages(orderId: string) {
  try { for (const path of ["/", "/products", "/admin", "/admin/orders", "/member/dashboard", "/member/orders", "/user/orders", "/user/dashboard", "/track-order", `/order-success/${encodeURIComponent(orderId)}`]) revalidatePath(path); }
  catch { console.warn("Financial state saved; page refresh deferred."); }
}
