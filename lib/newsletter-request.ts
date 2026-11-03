import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccountRequestError } from "@/lib/account-request";
import { NewsletterError } from "@/lib/newsletter-policy";
export const newsletterHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export function newsletterJsonRequest(request: Request) {
  if (new URL(request.url).search) throw new NewsletterError("Newsletter actions do not accept query parameters.", 400, "NEWSLETTER_REQUEST");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new NewsletterError("Use a JSON request body.", 415, "NEWSLETTER_REQUEST");
}
export function newsletterFailure(error: unknown) {
  if (error instanceof NewsletterError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof NewsletterError ? error.code : "NEWSLETTER_REQUEST" }, { status: error.status, headers: { ...newsletterHeaders, ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the email, explicit consent, request reference or newsletter link.", code: "NEWSLETTER_REQUEST" }, { status: 400, headers: newsletterHeaders });
  console.error("Newsletter operation unavailable; recipient, token, provider and database details were not logged.");
  return NextResponse.json({ success: false, message: "The newsletter operation was not confirmed. Keep the original request for retry.", code: "NEWSLETTER_UNAVAILABLE" }, { status: 503, headers: newsletterHeaders });
}
