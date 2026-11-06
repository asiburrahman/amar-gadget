import { NextResponse } from "next/server";
import { limitAccountIp, readAccountJson } from "@/lib/account-request";
import { changeNewsletterPreference } from "@/lib/newsletter";
import { newsletterFailure, newsletterHeaders, newsletterJsonRequest } from "@/lib/newsletter-request";
export async function POST(request: Request) {
  try {
    await limitAccountIp(request, "newsletter-confirm", 20, 60); newsletterJsonRequest(request);
    await changeNewsletterPreference(await readAccountJson(request, 512), "CONFIRM");
    return NextResponse.json({ success: true, message: "Your newsletter subscription is confirmed." }, { headers: newsletterHeaders });
  } catch (error) { return newsletterFailure(error); }
}
