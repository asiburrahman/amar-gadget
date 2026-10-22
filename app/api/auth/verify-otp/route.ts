import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signJwtToken } from "@/lib/auth";
import { verifyOtpSchema } from "@/lib/validations/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const limit = await rateLimit(getClientIp(req.headers), 5, 60, "auth-verify-otp");
    if (!limit.success) {
      return NextResponse.json({ success: false, message: "Too many verification attempts. Try again shortly." }, { status: 429 });
    }

    const parsed = verifyOtpSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Email and OTP verification code are required." },
        { status: 400 }
      );
    }
    const { email, otp } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    // Find latest OTP token for email
    const otpRecord = await prisma.otpToken.findFirst({
      where: {
        email: normalizedEmail,
        code: otp,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired OTP verification code." },
        { status: 400 }
      );
    }

    // Find user and mark as verified
    const user = await prisma.$transaction(async (tx) => {
      const claimed = await tx.otpToken.deleteMany({
        where: { id: otpRecord.id, expiresAt: { gte: new Date() } },
      });
      if (claimed.count !== 1) return null;

      const foundUser = await tx.user.findUnique({ where: { email: normalizedEmail } });
      if (!foundUser) return null;
      await tx.user.update({
        where: { id: foundUser.id },
        data: { isVerified: true },
      });
      await tx.otpToken.deleteMany({ where: { email: normalizedEmail } });
      return foundUser;
    });
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired OTP verification code." },
        { status: 400 }
      );
    }

    // Generate signed JWT token
    const token = await signJwtToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const response = NextResponse.json({
      success: true,
      message: "Email successfully verified!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 604800, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("OTP Verification Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error during verification." },
      { status: 500 }
    );
  }
}