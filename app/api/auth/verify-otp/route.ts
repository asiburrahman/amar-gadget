import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signJwtToken, verifyPassword, hashPassword, passwordNeedsRehash } from "@/lib/auth";
import { verifyOtpSchema } from "@/lib/validations/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { prepareOtpAttempt, consumeVerifiedOtp, otpAccountFingerprint } from "@/lib/otp";
import { otpErrorResponse } from "@/lib/otp-response";

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getClientIp(req.headers), 5, 60, "auth-verify-otp")).success) return NextResponse.json({ success: false, message: "Too many verification attempts. Try again shortly." }, { status: 429 });
    const parsed = verifyOtpSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Enter your email, six-digit signup code and registration password." }, { status: 400 });
    const input = parsed.data;
    const found = await prisma.user.findUnique({ where: { email: input.email } });
    const invalid = () => NextResponse.json({ success: false, message: "Invalid or expired verification details. Use the password from registration or reset your password." }, { status: 400 });
    if (!found || found.isVerified || !found.password) return invalid();
    const ticket = await prepareOtpAttempt({ userId: found.id, email: input.email, purpose: "REGISTRATION" }, input.otp);
    if (!ticket || ticket.accountFingerprint !== otpAccountFingerprint(found) || !(await verifyPassword(input.password, found.password))) return invalid();
    const upgraded = passwordNeedsRehash(found.password) ? await hashPassword(input.password) : undefined;
    // Validate signing configuration before committing verification. The
    // locked account fingerprint is rechecked before this token is returned.
    const token = await signJwtToken({ id: found.id, email: found.email, name: found.name, role: found.role, sessionVersion: found.sessionVersion + 1 });
    const user = await consumeVerifiedOtp(ticket, (tx, current) => tx.user.update({ where: { id: current.id }, data: { isVerified: true, ...(upgraded ? { password: upgraded } : {}) } }));
    if (!user) return invalid();
    const response = NextResponse.json({ success: true, message: "Email successfully verified!", user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar, phone: user.phone, sellerStatus: user.sellerStatus, isVerified: user.isVerified } });
    response.cookies.set("auth_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 604800, path: "/" });
    return response;
  } catch (error) { return otpErrorResponse(error); }
}
