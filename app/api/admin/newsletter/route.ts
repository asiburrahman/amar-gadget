import { NextResponse } from "next/server";
import { limitAccountIp, limitAccountIdentity } from "@/lib/account-request";
import { getCurrentUserWithRole } from "@/lib/session";
import { NewsletterError } from "@/lib/newsletter-policy";
import { newsletterFailure, newsletterHeaders } from "@/lib/newsletter-request";
import { readNewsletterAdministration } from "@/lib/newsletter-administration";
export async function GET(request: Request) {
  try {
    await limitAccountIp(request, "newsletter-admin-read", 120, 60);
    const actor = await getCurrentUserWithRole(["ADMIN"]);
    if (!actor) throw new NewsletterError("Current administrator access is required.", 403, "NEWSLETTER_FORBIDDEN");
    if (request.headers.get("x-newsletter-owner") !== actor.id) throw new NewsletterError("The active administrator changed. Reload this page.", 409, "NEWSLETTER_OWNER_CHANGED");
    await limitAccountIdentity(actor.id, "newsletter-admin-read", 120, 60);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new NewsletterError("Use each newsletter filter once.", 400, "NEWSLETTER_REQUEST");
    return NextResponse.json({ success: true, ...await readNewsletterAdministration(actor, { mode: params.get("mode") ?? "SUBSCRIBERS", ...Object.fromEntries(params) }) }, { headers: newsletterHeaders });
  } catch (error) { return newsletterFailure(error); }
}
