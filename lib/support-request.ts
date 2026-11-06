import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccountRequestError, limitAccountIp, limitAccountIdentity } from "@/lib/account-request";
import { getCurrentUserWithRole } from "@/lib/session";
import { SupportError } from "@/lib/support-policy";

export const supportHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function supportActor(request: Request, write = false) {
  await limitAccountIp(request, write ? "support-admin-write" : "support-admin-read", write ? 30 : 120);
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) throw new SupportError("Current administrator access is required.", 403, "SUPPORT_FORBIDDEN");
  if (request.headers.get("x-support-owner") !== actor.id) throw new SupportError("The active account changed. Reload support messages.", 409, "SUPPORT_OWNER_CHANGED");
  await limitAccountIdentity(actor.id, write ? "support-admin-write" : "support-admin-read", write ? 30 : 120, 60);
  return actor;
}
export function supportQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new SupportError("Use each support filter once.", 400, "SUPPORT_REQUEST");
  return Object.fromEntries(params);
}
export function supportJsonContent(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SupportError("Use a JSON request body.", 415, "SUPPORT_REQUEST");
}
export function supportFailure(error: unknown) {
  if (error instanceof SupportError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof SupportError ? error.code : "SUPPORT_REQUEST" }, { status: error.status, headers: { ...supportHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the required fields, consent, length limits and saved revision.", code: "SUPPORT_REQUEST" }, { status: 400, headers: supportHeaders });
  console.error("Support operation unavailable; contact details, message content and database errors were not logged.");
  return NextResponse.json({ success: false, message: "The operation was not confirmed. Keep the original details and reference for an exact retry.", code: "SUPPORT_UNAVAILABLE" }, { status: 503, headers: supportHeaders });
}
