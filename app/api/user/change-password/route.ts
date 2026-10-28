import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyPassword, hashPassword, PasswordWorkloadBusy } from "@/lib/auth";
import { validateSessionToken } from "@/lib/session-validation";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    const account = await validateSessionToken(token);
    if (!account) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword, confirmPassword } = await req.json();

    if (typeof newPassword !== "string" || newPassword.length < 6 || newPassword.length > 4096) {
      return NextResponse.json(
        { success: false, message: "New password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "New password and confirmation do not match." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: account.id },
      select: { id: true, password: true, sessionVersion: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 401 }
      );
    }
    if (user.sessionVersion !== account.sessionVersion) return NextResponse.json({ success: false, message: "Your credentials changed. Sign in again before changing the password." }, { status: 409 });

    // If user has an existing password, verify it
    if (!user.password) return NextResponse.json({ success: false, message: "Set a password through the verified password-reset flow." }, { status: 400 });
    if (user.password) {
      if (!currentPassword) {
        return NextResponse.json(
          { success: false, message: "Current password is required." },
          { status: 400 }
        );
      }

      const isCurrentValid = await verifyPassword(currentPassword, user.password);
      if (!isCurrentValid) {
        return NextResponse.json(
          { success: false, message: "Current password is incorrect." },
          { status: 400 }
        );
      }
    }

    // Hash and update to new password
    const hashed = await hashPassword(newPassword);

    const updated = await prisma.user.updateMany({
      where: { id: user.id, password: user.password, sessionVersion: account.sessionVersion },
      data: { password: hashed },
    });
    if (updated.count !== 1) return NextResponse.json({ success: false, message: "Your credentials changed. Sign in again before changing the password." }, { status: 409 });

    const response = NextResponse.json({
      success: true,
      message: "Password updated. All sessions have been signed out. Sign in with your new password.",
    });
    response.cookies.set("auth_token", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
    return response;
  } catch (error) {
    if (error instanceof PasswordWorkloadBusy) return NextResponse.json({ success: false, message: error.message }, { status: 503, headers: { "Retry-After": "5" } });
    console.error("POST /api/user/change-password error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update password." },
      { status: 500 }
    );
  }
}
