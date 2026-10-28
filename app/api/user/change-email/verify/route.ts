import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { signJwtToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accountEmailSchema, otpCodeSchema } from "@/lib/validations/auth";
import { prepareOtpAttempt, consumeVerifiedOtp, otpAccountFingerprint } from "@/lib/otp";
import { otpErrorResponse } from "@/lib/otp-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ newEmail: accountEmailSchema, otp: otpCodeSchema });
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getClientIp(req.headers), 5, 60, "email-change-verify")).success) return NextResponse.json({ success: false, message: "Too many verification attempts. Try again shortly." }, { status: 429 });
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Enter the new email and its six-digit email-change code." }, { status: 400 });
    const { newEmail, otp } = parsed.data;
    const invalid = () => NextResponse.json({ success: false, message: "Invalid or expired email-change code. Request a fresh code from this account." }, { status: 400 });
    const ticket = await prepareOtpAttempt({ userId: actor.id, email: newEmail, purpose: "EMAIL_CHANGE" }, otp);
    if (!ticket) return invalid();
    const account = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!account || otpAccountFingerprint(account) !== ticket.accountFingerprint) return invalid();
    const token = await signJwtToken({ id: account.id, email: newEmail, name: account.name, role: account.role, sessionVersion: account.sessionVersion + 1 });
    const updated = await consumeVerifiedOtp(ticket, (tx, user) => tx.user.update({ where: { id: user.id }, data: { email: newEmail, isVerified: true }, select: { id: true, name: true, email: true, role: true, avatar: true, phone: true, sellerStatus: true, isVerified: true } }));
    if (!updated) return invalid();
    const response = NextResponse.json({ success: true, message: "Email address updated and verified.", user: updated });
    response.cookies.set("auth_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 604800, path: "/" });
    return response;
  } catch (error) { return otpErrorResponse(error); }
}
