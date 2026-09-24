import { NextResponse } from "next/server";
import { sendOtpEmail } from "@/lib/mail/send-otp";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ success: false, message: "Email is required." }, { status: 400 });
    }

    const result = await sendOtpEmail(email);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Fresh OTP verification code has been dispatched to your email!",
      });
    } else {
      return NextResponse.json({ success: false, message: result.error || "Failed to resend OTP." }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error during OTP resend." }, { status: 500 });
  }
}