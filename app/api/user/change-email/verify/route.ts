import { NextResponse } from "next/server";
import { accountWithSafeAvatar } from "@/lib/avatar-policy";
import { getCurrentUser } from "@/lib/session";
import { signJwtToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emailChangeVerifySchema } from "@/lib/validations/auth";
import { prepareOtpAttempt, consumeVerifiedOtp, otpAccountFingerprint } from "@/lib/otp";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "email-change-verify", 5);
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
    await limitAccountIdentity(actor.id, "email-change-verify");
    const parsed = emailChangeVerifySchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Enter the new email and its six-digit email-change code." }, { status: 400 });
    const { newEmail, otp } = parsed.data;
    const invalid = () => NextResponse.json({ success: false, message: "Invalid or expired email-change code. Request a fresh code from this account." }, { status: 400 });
    const ticket = await prepareOtpAttempt({ userId: actor.id, email: newEmail, purpose: "EMAIL_CHANGE" }, otp);
    if (!ticket) return invalid();
    const account = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!account || otpAccountFingerprint(account) !== ticket.accountFingerprint) return invalid();
    const token = await signJwtToken({ id: account.id, email: newEmail, name: account.name, role: account.role, sessionVersion: account.sessionVersion + 1 });
    const updated = await consumeVerifiedOtp(ticket, (tx, user) => tx.user.update({ where: { id: user.id }, data: { email: newEmail, isVerified: true }, select: { id: true, name: true, email: true, role: true, avatar: true, avatarKey: true, avatarVersion: true, phone: true, sellerStatus: true, isVerified: true } }));
    if (!updated) return invalid();
    const response = NextResponse.json({ success: true, message: "Email address updated and verified.", user: accountWithSafeAvatar(updated) });
    response.cookies.set("auth_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 604800, path: "/" });
    return response;
  } catch (error) { return accountErrorResponse(error); }
}
