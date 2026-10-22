import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const limit = await rateLimit(getClientIp(req.headers), 5, 60, "auth-resend-otp");
    if (!limit.success) {
      return NextResponse.json({ success: false, message: "Too many requests. Try again shortly." }, { status: 429 });
    }

    const parsed = z.object({ email: z.string().email() }).safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { isVerified: true },
    });
    if (!user || user.isVerified) {
      return NextResponse.json({
        success: true,
        message: "If the account needs verification, a code has been sent.",
      });
    }

    const result = await sendOtpEmail(email);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Fresh OTP verification code has been dispatched to your email!",
      });
    } else {
      return NextResponse.json({ success: false, message: "Failed to resend verification code." }, { status: 500 });
    }
  } catch (error) {
    console.error("OTP resend failed:", error);
    return NextResponse.json({ success: false, message: "Server error during OTP resend." }, { status: 500 });
  }
}