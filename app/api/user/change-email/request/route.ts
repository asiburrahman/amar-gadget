import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwtToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/mail/send-otp";

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

    const { newEmail } = await req.json();

    if (!newEmail || typeof newEmail !== "string") {
      return NextResponse.json(
        { success: false, message: "Please provide a valid new email address." },
        { status: 400 }
      );
    }

    const normalizedNewEmail = newEmail.trim().toLowerCase();

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedNewEmail)) {
      return NextResponse.json(
        { success: false, message: "Invalid email format." },
        { status: 400 }
      );
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: { id: true, email: true },
    });

    if (!currentUser) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    if (currentUser.email.toLowerCase() === normalizedNewEmail) {
      return NextResponse.json(
        { success: false, message: "The new email is the same as your current email." },
        { status: 400 }
      );
    }

    // Check if new email is already taken by another account
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedNewEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, message: "This email address is already registered to another account." },
        { status: 400 }
      );
    }

    // Send OTP verification email to the new email address
    const otpResult = await sendOtpEmail(normalizedNewEmail);

    if (!otpResult.success) {
      return NextResponse.json(
        { success: false, message: otpResult.error || "Failed to send verification code." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedNewEmail}. Please enter it to confirm the change.`,
      email: normalizedNewEmail,
    });
  } catch (error: any) {
    console.error("POST /api/user/change-email/request error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
