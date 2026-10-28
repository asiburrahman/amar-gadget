import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { accountEmailSchema } from "@/lib/validations/auth";
import { otpAccountFingerprint } from "@/lib/otp";
import { otpDeliveryFailure, otpErrorResponse } from "@/lib/otp-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ newEmail: accountEmailSchema, currentPassword: z.string().min(1) });
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getClientIp(req.headers), 5, 60, "email-change-request")).success) return NextResponse.json({ success: false, message: "Too many requests. Try again shortly." }, { status: 429 });
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Enter a valid new email and your current password." }, { status: 400 });
    const { newEmail, currentPassword } = parsed.data;
    const account = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!account?.password || !(await verifyPassword(currentPassword, account.password))) return NextResponse.json({ success: false, message: "Current password could not be verified. Set a password first if your account does not have one." }, { status: 400 });
    if (newEmail === account.email || await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })) return NextResponse.json({ success: false, message: "Choose a different available email address." }, { status: 409 });
    const result = await sendOtpEmail({ userId: account.id, email: newEmail, purpose: "EMAIL_CHANGE", expectedAccountFingerprint: otpAccountFingerprint(account) });
    if (!result.success) return otpDeliveryFailure(result);
    return NextResponse.json({ success: true, message: "A six-digit email-change code was sent to the new address.", email: newEmail });
  } catch (error) { return otpErrorResponse(error); }
}
