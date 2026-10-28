import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { otpDeliveryFailure, otpErrorResponse } from "@/lib/otp-response";

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getClientIp(req.headers), 5, 60, "auth-forgot-password")).success) return NextResponse.json({ success: false, message: "Too many requests. Try again shortly." }, { status: 429 });
    const parsed = forgotPasswordSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Please provide a valid email address." }, { status: 400 });
    const email = parsed.data.email;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const result = await sendOtpEmail({ userId: user.id, email, purpose: "PASSWORD_RESET" });
      if (!result.success) return otpDeliveryFailure(result);
    }
    return NextResponse.json({ success: true, message: "If an account exists with this email, a reset code has been sent." });
  } catch (error) { return otpErrorResponse(error); }
}
