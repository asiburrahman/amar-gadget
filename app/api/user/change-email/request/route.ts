import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { emailChangeRequestSchema } from "@/lib/validations/auth";
import { otpAccountFingerprint } from "@/lib/otp";
import { otpDeliveryFailure } from "@/lib/otp-response";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "email-change-request", 5);
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
    await limitAccountIdentity(actor.id, "email-change-request");
    const parsed = emailChangeRequestSchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: "Enter a valid new email and your current password." }, { status: 400 });
    const { newEmail, currentPassword } = parsed.data;
    const account = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!account?.password || !(await verifyPassword(currentPassword, account.password))) return NextResponse.json({ success: false, message: "Current password could not be verified. Set a password first if your account does not have one." }, { status: 400 });
    if (newEmail === account.email || await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })) return NextResponse.json({ success: false, message: "Choose a different available email address." }, { status: 409 });
    const result = await sendOtpEmail({ userId: account.id, email: newEmail, purpose: "EMAIL_CHANGE", expectedAccountFingerprint: otpAccountFingerprint(account) });
    if (!result.success) return otpDeliveryFailure(result);
    return NextResponse.json({ success: true, message: "A six-digit email-change code was sent to the new address.", email: newEmail });
  } catch (error) { return accountErrorResponse(error); }
}
