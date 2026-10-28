import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { accountEmailSchema, otpCodeSchema } from "@/lib/validations/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { prepareOtpAttempt, consumeVerifiedOtp } from "@/lib/otp";
import { otpErrorResponse } from "@/lib/otp-response";

// Password policy unification is AUD-011; this preserves the current minimum.
const schema = z.object({ email: accountEmailSchema, otp: otpCodeSchema, newPassword: z.string().min(6).max(4096), confirmPassword: z.string().optional() })
  .refine((input) => !input.confirmPassword || input.confirmPassword === input.newPassword);

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getClientIp(req.headers), 5, 60, "auth-reset-password")).success) return NextResponse.json({ success: false, message: "Too many password reset attempts. Try again shortly." }, { status: 429 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Check your email, six-digit reset code and matching passwords (at least six characters)." }, { status: 400 });
    const input = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const invalid = () => NextResponse.json({ success: false, message: "Invalid or expired password reset code." }, { status: 400 });
    if (!user) return invalid();
    const ticket = await prepareOtpAttempt({ userId: user.id, email: input.email, purpose: "PASSWORD_RESET" }, input.otp);
    if (!ticket) return invalid();
    const password = await hashPassword(input.newPassword);
    const changed = await consumeVerifiedOtp(ticket, (tx, current) => tx.user.update({ where: { id: current.id }, data: { password, isVerified: true } }));
    if (!changed) return invalid();
    return NextResponse.json({ success: true, message: "Password reset successful. Sign in with your new password." });
  } catch (error) { return otpErrorResponse(error); }
}
