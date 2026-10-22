import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const limit = await rateLimit(getClientIp(req.headers), 5, 60, "auth-reset-password");
    if (!limit.success) {
      return NextResponse.json({ success: false, message: "Too many password reset attempts. Try again shortly." }, { status: 429 });
    }

    const { email, otp, newPassword, confirmPassword } = await req.json();

    if (
      typeof email !== "string" ||
      typeof otp !== "string" ||
      typeof newPassword !== "string" ||
      !email ||
      !otp ||
      !newPassword
    ) {
      return NextResponse.json(
        { success: false, message: "Email, OTP verification code, and new password are required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "Passwords do not match." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedOtp = otp.toString().trim();

    // Verify OTP in DB
    const otpRecord = await prisma.otpToken.findFirst({
      where: {
        email: normalizedEmail,
        code: trimmedOtp,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 400 }
      );
    }

    // Find and update user's password
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Account not found." },
        { status: 404 }
      );
    }

    const hashedPassword = hashPassword(newPassword);

    const changed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.otpToken.deleteMany({
        where: { id: otpRecord.id, expiresAt: { gte: new Date() } },
      });
      if (claimed.count !== 1) return false;

      await tx.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          isVerified: true,
        },
      });
      await tx.otpToken.deleteMany({ where: { email: normalizedEmail } });
      return true;
    });
    if (!changed) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Password reset successful! You can now sign in with your new password.",
    });
  } catch (error: any) {
    console.error("POST /api/auth/reset-password error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to reset password." },
      { status: 500 }
    );
  }
}
