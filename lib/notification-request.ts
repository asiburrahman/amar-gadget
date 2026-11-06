import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountRequestError, limitAccountIp, limitAccountIdentity } from "@/lib/account-request";
import { NotificationError } from "@/lib/notification-policy";
export const notificationHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function notificationActor(request: Request, write = false, administrator = false) {
  await limitAccountIp(request, write ? "notification-write" : "notification-read", write ? 60 : 120);
  const actor = await getCurrentUserWithRole(administrator ? ["ADMIN"] : ["USER", "MEMBER", "ADMIN"]);
  if (!actor) throw new NotificationError("Current inbox access is required.", "NOTIFICATION_FORBIDDEN", 403);
  if (request.headers.get("x-notification-owner") !== actor.id) throw new NotificationError("The active account changed. Reload your inbox.", "NOTIFICATION_OWNER_CHANGED");
  await limitAccountIdentity(actor.id, write ? "notification-write" : "notification-read", write ? 40 : 120, 60); return actor;
}
export function notificationQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new NotificationError("Use each inbox query field once.", "NOTIFICATION_REQUEST", 400);
  return Object.fromEntries(params);
}
export function notificationFailure(error: unknown) {
  if (error instanceof NotificationError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof NotificationError ? error.code : "NOTIFICATION_REQUEST" }, { status: error.status, headers: { ...notificationHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the inbox filters, notification IDs, saved revisions and retry reason.", code: "NOTIFICATION_REQUEST" }, { status: 400, headers: notificationHeaders });
  console.error("Notification operation unavailable; private messages, requests and database details were not logged.");
  return NextResponse.json({ success: false, message: "The inbox change was not confirmed. Reload the saved state before retrying.", code: "NOTIFICATION_UNAVAILABLE" }, { status: 503, headers: notificationHeaders });
}
