import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "auth-forgot-password", 5);
    const parsed = forgotPasswordSchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Please provide a valid email address." }, { status: 400 });
    const email = parsed.data.email;
    await limitAccountIdentity(email, "auth-forgot-password", 3, 600);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const result = await sendOtpEmail({ userId: user.id, email, purpose: "PASSWORD_RESET" });
      if (!result.success) console.warn("Password-reset request accepted; delivery did not complete.");
    }
    return NextResponse.json({ success: true, accepted: true, message: "Request received. If this address is eligible, check your inbox for a new or recently requested reset code. If none arrives, retry later." });
  } catch (error) { return accountErrorResponse(error); }
}
