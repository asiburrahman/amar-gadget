import { NextResponse } from "next/server";
import { limitAccountIp, readAccountJson } from "@/lib/account-request";
import { changeNewsletterPreference } from "@/lib/newsletter";
import { newsletterFailure, newsletterHeaders, newsletterJsonRequest } from "@/lib/newsletter-request";
export async function POST(request: Request) {
  try {
    await limitAccountIp(request, "newsletter-unsubscribe", 20, 60); newsletterJsonRequest(request);
    await changeNewsletterPreference(await readAccountJson(request, 512), "UNSUBSCRIBE");
    return NextResponse.json({ success: true, message: "Newsletter consent is withdrawn. A later subscription requires a fresh email confirmation." }, { headers: newsletterHeaders });
  } catch (error) { return newsletterFailure(error); }
}
