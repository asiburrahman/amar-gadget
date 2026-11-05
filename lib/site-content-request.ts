import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccountRequestError, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { getCurrentUserWithRole } from "@/lib/session";
import { serviceUnavailable } from "@/lib/observability";
import { SiteContentError } from "@/lib/site-content-policy";

export const siteContentHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function siteContentActor(request: Request, write = false) {
  const operation = write ? "site-content-admin-write" : "site-content-admin-read", limit = write ? 30 : 120;
  await limitAccountIp(request, operation, limit);
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  // AuthenticatedUser deliberately omits verification flags. The service
  // checks the current verified administrator and session under a row lock.
  if (!actor || actor.role !== "ADMIN") throw new SiteContentError("Current administrator access is required.", 403, "SITE_CONTENT_FORBIDDEN");
  if (request.headers.get("x-site-content-owner") !== actor.id) throw new SiteContentError("The active administrator changed. Reload this page.", 409, "SITE_CONTENT_OWNER_CHANGED");
  await limitAccountIdentity(actor.id, operation, limit, 60);
  return actor;
}
export function siteContentQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new SiteContentError("Use each content filter once.", 400, "SITE_CONTENT_REQUEST");
  return Object.fromEntries(params);
}
export function siteContentJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SiteContentError("Use a JSON request body.", 415, "SITE_CONTENT_REQUEST");
}
export function siteContentFailure(error: unknown) {
  if (error instanceof SiteContentError || error instanceof AccountRequestError) {
    return NextResponse.json({ success: false, message: error.message, code: error instanceof SiteContentError ? error.code : "SITE_CONTENT_REQUEST" }, {
      status: error.status, headers: { ...siteContentHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the document fields, URL slug, saved revision and publication review.", code: "SITE_CONTENT_REQUEST" }, { status: 400, headers: siteContentHeaders });
  const incident = serviceUnavailable("site_content.http", error).incident;
  return NextResponse.json({ success: false, message: "The content service is unavailable. Keep the original decision and reference for retry.", code: "SITE_CONTENT_UNAVAILABLE", reference: incident.reference }, { status: 503, headers: siteContentHeaders });
}
