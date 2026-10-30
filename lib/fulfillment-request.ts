import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { FulfillmentError } from "@/lib/fulfillment-policy";
export const fulfillmentPrivateHeaders = { "Cache-Control": "private, no-store" };
export async function fulfillmentActor(request: Request, write = false, role?: "ADMIN" | "MEMBER") {
  const operation = write ? "shipment-write" : "shipment-read";
  await limitAccountIp(request, operation, write ? 30 : 120);
  const actor = await getCurrentUser();
  if (!actor) throw new FulfillmentError("Sign in to manage shipments.", "FULFILLMENT_ACCOUNT_CHANGED", 401);
  if (request.headers.get("x-fulfillment-owner") !== actor.id) throw new FulfillmentError("The active account changed. Reload your session.", "FULFILLMENT_ACCOUNT_CHANGED");
  if ((role && actor.role !== role) || !["ADMIN", "MEMBER"].includes(actor.role) || (actor.role === "MEMBER" && actor.sellerStatus !== "APPROVED")) throw new FulfillmentError("Shipment management is not available for this account.", "FORBIDDEN", 403);
  await limitAccountIdentity(actor.id, operation, write ? 12 : 120, 60);
  return actor;
}
export function fulfillmentQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new FulfillmentError("Use each shipment query field once.", "FULFILLMENT_REQUEST", 400);
  return Object.fromEntries(params);
}
export function fulfillmentFailure(error: unknown) {
  if (error instanceof FulfillmentError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof FulfillmentError ? error.code : "FULFILLMENT_REQUEST" }, { status: error.status, headers: { ...fulfillmentPrivateHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the shipment fields, tracking details and observed revision.", code: "FULFILLMENT_REQUEST" }, { status: 400, headers: fulfillmentPrivateHeaders });
  console.error("Shipment request unavailable; private request/provider details were not logged.");
  return NextResponse.json({ success: false, message: "Unable to confirm the shipment request. Reload its saved state before retrying.", code: "FULFILLMENT_UNAVAILABLE" }, { status: 503, headers: fulfillmentPrivateHeaders });
}
export function invalidateFulfillmentPages(orderId: string) {
  try {
    for (const path of ["/admin/orders", "/member/orders", "/member/dashboard", "/user/orders", "/user/dashboard", "/track-order", `/order-success/${encodeURIComponent(orderId)}`]) revalidatePath(path);
  } catch { console.warn("Shipment saved; page refresh deferred."); }
}
