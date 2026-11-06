import { NextResponse } from "next/server";
import { limitAccountIp, limitAccountIdentity, readAccountJson } from "@/lib/account-request";
import { newsletterSubscribeSchema } from "@/lib/validations/newsletter";
import { submitNewsletterSubscription } from "@/lib/newsletter";
import { newsletterFailure, newsletterHeaders, newsletterJsonRequest } from "@/lib/newsletter-request";
export async function POST(request: Request) {
  try {
    await limitAccountIp(request, "newsletter-request", 20, 60); newsletterJsonRequest(request);
    const input = newsletterSubscribeSchema.parse(await readAccountJson(request, 2048));
    await limitAccountIdentity(input.email, "newsletter-request", 12, 600);
    const receipt = await submitNewsletterSubscription(input);
    return NextResponse.json({ success: true, receipt, message: "Request recorded. Check your email for confirmation or preference instructions. This receipt does not activate a subscription or guarantee inbox delivery." }, { status: 202, headers: newsletterHeaders });
  } catch (error) { return newsletterFailure(error); }
}
