import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { otpDeliveryFailure, otpErrorResponse } from "@/lib/otp-response";

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getClientIp(req.headers), 5, 60, "auth-resend-otp")).success) return NextResponse.json({ success: false, message: "Too many requests. Try again shortly." }, { status: 429 });
    const parsed = forgotPasswordSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
    const email = parsed.data.email;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isVerified: true } });
    if (user && !user.isVerified) {
      const result = await sendOtpEmail({ userId: user.id, email, purpose: "REGISTRATION" });
      if (!result.success) return otpDeliveryFailure(result);
    }
    return NextResponse.json({ success: true, message: "If the account needs verification, a signup code has been sent. Use your registration password with that code." });
  } catch (error) { return otpErrorResponse(error); }
}
