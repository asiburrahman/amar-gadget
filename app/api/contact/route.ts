import { NextResponse } from "next/server";
import { limitAccountIp, limitAccountIdentity, readAccountJson } from "@/lib/account-request";
import { supportSubmissionSchema } from "@/lib/validations/support";
import { submitSupportMessage } from "@/lib/support";
import { SupportError } from "@/lib/support-policy";
import { supportFailure, supportHeaders, supportJsonContent, supportQuery } from "@/lib/support-request";

export async function POST(request: Request) {
  try {
    await limitAccountIp(request, "support-submit", 5, 60);
    if (Object.keys(supportQuery(request)).length) throw new SupportError("Submission does not accept query parameters.", 400, "SUPPORT_REQUEST");
    supportJsonContent(request);
    const input = supportSubmissionSchema.parse(await readAccountJson(request, 48 * 1024));
    await limitAccountIdentity(input.email, "support-submit", 3, 600);
    const receipt = await submitSupportMessage(input);
    return NextResponse.json({ success: true, receipt, message: "Your message is saved for administrator review. Keep the receipt reference. No reply time is promised." }, { status: 201, headers: supportHeaders });
  } catch (error) { return supportFailure(error); }
}
