import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { validateSessionToken } from "@/lib/session-validation";
import { prisma } from "@/lib/prisma";
import { changePasswordSchema, PASSWORD_POLICY_MESSAGE } from "@/lib/validations/auth";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "password-change", 5);
    const token = (await cookies()).get("auth_token")?.value;
    const account = token ? await validateSessionToken(token) : null;
    if (!account) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
    await limitAccountIdentity(account.id, "password-change");
    const parsed = changePasswordSchema.safeParse(await readAccountJson(req));
    if (!parsed.success) return NextResponse.json({ success: false, message: `Enter your current password and matching new passwords. ${PASSWORD_POLICY_MESSAGE}` }, { status: 400 });
    const { currentPassword, newPassword } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: account.id }, select: { id: true, password: true, sessionVersion: true } });
    if (!user) return NextResponse.json({ success: false, message: "Invalid session." }, { status: 401 });
    if (user.sessionVersion !== account.sessionVersion) return NextResponse.json({ success: false, message: "Your credentials changed. Sign in again." }, { status: 409 });
    if (!user.password) return NextResponse.json({ success: false, message: "Set a password through the verified password-reset flow." }, { status: 400 });
    if (!(await verifyPassword(currentPassword, user.password))) return NextResponse.json({ success: false, message: "Current password is incorrect." }, { status: 400 });
    const password = await hashPassword(newPassword);
    const updated = await prisma.user.updateMany({ where: { id: user.id, password: user.password, sessionVersion: account.sessionVersion }, data: { password } });
    if (updated.count !== 1) return NextResponse.json({ success: false, message: "Your credentials changed. Sign in again." }, { status: 409 });
    const response = NextResponse.json({ success: true, message: "Password updated. All sessions have been signed out. Sign in with your new password." });
    response.cookies.set("auth_token", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
    return response;
  } catch (error) { return accountErrorResponse(error); }
}
