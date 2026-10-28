import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { resetPasswordSchema, PASSWORD_POLICY_MESSAGE } from "@/lib/validations/auth";
import { prepareOtpAttempt, consumeVerifiedOtp } from "@/lib/otp";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "auth-reset-password", 5);
    const parsed = resetPasswordSchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: `Check your email, six-digit reset code and matching passwords. ${PASSWORD_POLICY_MESSAGE}` }, { status: 400 });
    const input = parsed.data;
    await limitAccountIdentity(input.email, "auth-reset-password");
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const invalid = () => NextResponse.json({ success: false, message: "Invalid or expired password reset code." }, { status: 400 });
    if (!user) return invalid();
    const ticket = await prepareOtpAttempt({ userId: user.id, email: input.email, purpose: "PASSWORD_RESET" }, input.otp);
    if (!ticket) return invalid();
    const password = await hashPassword(input.newPassword);
    const changed = await consumeVerifiedOtp(ticket, (tx, current) => tx.user.update({ where: { id: current.id }, data: { password, isVerified: true } }));
    if (!changed) return invalid();
    return NextResponse.json({ success: true, message: "Password reset successful. Sign in with your new password." });
  } catch (error) { return accountErrorResponse(error); }
}
