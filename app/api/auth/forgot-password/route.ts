import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const limit = await rateLimit(getClientIp(req.headers), 5, 60, "auth-forgot-password");
    if (!limit.success) {
      return NextResponse.json({ success: false, message: "Too many requests. Try again shortly." }, { status: 429 });
    }

    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, message: "Please provide a valid email address." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Return success anyway to avoid user enumeration
      return NextResponse.json({
        success: true,
        message: "If an account exists with this email, a verification code has been sent.",
      });
    }

    // Generate & send OTP
    const result = await sendOtpEmail(normalizedEmail);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: "Failed to send reset verification code." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, a verification code has been sent.",
    });
  } catch (error: any) {
    console.error("POST /api/auth/forgot-password error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "An error occurred." },
      { status: 500 }
    );
  }
}