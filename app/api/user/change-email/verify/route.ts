import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwtToken, signJwtToken } from "@/lib/auth";
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

    const payload = await verifyJwtToken(token);
    if (!payload?.sub) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 401 }
      );
    }

    const { newEmail, otp } = await req.json();

    if (!newEmail || !otp) {
      return NextResponse.json(
        { success: false, message: "New email and 6-digit OTP code are required." },
        { status: 400 }
      );
    }

    const normalizedNewEmail = newEmail.trim().toLowerCase();
    const trimmedOtp = otp.toString().trim();

    // Find valid OTP record
    const otpRecord = await prisma.otpToken.findFirst({
      where: {
        email: normalizedNewEmail,
        code: trimmedOtp,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired OTP verification code. Please try again." },
        { status: 400 }
      );
    }

    // Double check email uniqueness
    const emailConflict = await prisma.user.findUnique({
      where: { email: normalizedNewEmail },
    });

    if (emailConflict && emailConflict.id !== payload.sub) {
      return NextResponse.json(
        { success: false, message: "This email was recently taken by another account." },
        { status: 400 }
      );
    }

    // Update user's email and ensure isVerified is true
    const updatedUser = await prisma.user.update({
      where: { id: payload.sub as string },
      data: {
        email: normalizedNewEmail,
        isVerified: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        phone: true,
        sellerStatus: true,
        isVerified: true,
      },
    });

    // Delete verified OTP tokens for this email
    await prisma.otpToken.deleteMany({
      where: { email: normalizedNewEmail },
    });

    // Re-issue JWT token with the new email
    const newToken = await signJwtToken({
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
    });

    const response = NextResponse.json({
      success: true,
      message: "Email address successfully updated and verified!",
      user: updatedUser,
    });

    response.cookies.set("auth_token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("POST /api/user/change-email/verify error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to verify email update." },
      { status: 500 }
    );
  }
}
