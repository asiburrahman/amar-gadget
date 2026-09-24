import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signJwtToken } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { email, otp } = await req.json();

    if (!email || !otp) {
      return NextResponse.json(
        { success: false, message: "Email and OTP verification code are required." },
        { status: 400 }
      );
    }

    // Find latest OTP token for email
    const otpRecord = await prisma.otpToken.findFirst({
      where: {
        email: email.toLowerCase(),
        code: otp.trim(),
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
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return NextResponse.json({ success: false, message: "User account not found." }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    // Delete verified OTP token
    await prisma.otpToken.deleteMany({
      where: { email: email.toLowerCase() },
    });

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