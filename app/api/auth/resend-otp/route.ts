import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "auth-resend-otp", 5);
    const parsed = forgotPasswordSchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
    const email = parsed.data.email;
    await limitAccountIdentity(email, "auth-resend-otp", 3, 600);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isVerified: true } });
    if (user && !user.isVerified) {
      const result = await sendOtpEmail({ userId: user.id, email, purpose: "REGISTRATION" });
      if (!result.success) console.warn("Signup-code request accepted; delivery did not complete.");
    }
    return NextResponse.json({ success: true, accepted: true, message: "Request received. If this account needs verification, check your inbox for a new or recently requested signup code. Use your registration password with it. If none arrives, retry later." });
  } catch (error) { return accountErrorResponse(error); }
}
