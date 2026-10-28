import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/auth";
import { hashPassword, PasswordWorkloadBusy } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { otpDeliveryFailure } from "@/lib/otp-response";
import { readAccountJson, limitAccountIp, limitAccountIdentity, accountErrorResponse } from "@/lib/account-request";

export async function POST(req: Request) {
  try {
    await limitAccountIp(req, "auth-register", 5);

    const body = await readAccountJson(req, 7 * 1024 * 1024 + 16 * 1024);
    const validated = registerSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Validation error",
          errors: validated.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { name, email, password, confirmPassword, role, avatar } = validated.data;
    await limitAccountIdentity(email, "auth-register", 3, 600);

    if (confirmPassword && confirmPassword !== password) {
      return NextResponse.json(
        {
          success: false,
          message: "Passwords do not match.",
        },
        { status: 400 }
      );
    }

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      if (existingUser.isVerified) {
        return NextResponse.json(
          {
            success: false,
            message: "An account with this email address already exists. Please log in.",
          },
          { status: 409 }
        );
      }

      // User registered previously but did not verify OTP!
      // Update user details, reset password hash, and dispatch a fresh OTP code
      const hashedPassword = await hashPassword(password);
      const updated = await prisma.user.updateMany({
        where: { id: existingUser.id, isVerified: false, password: existingUser.password },
        data: {
          name,
          password: hashedPassword,
          avatar: avatar || existingUser.avatar,
          role: existingUser.role,
        },
      });
      if (updated.count !== 1) return NextResponse.json({ success: false, message: "The account changed. Please sign in or retry registration." }, { status: 409 });

      // Dispatch fresh OTP verification email
      const otpResult = await sendOtpEmail({ userId: existingUser.id, email: existingUser.email, purpose: "REGISTRATION" });
      if (!otpResult.success) {
        return otpDeliveryFailure(otpResult);
      }

      return NextResponse.json({
        success: true,
        requiresOtp: true,
        email: existingUser.email,
        message: "Your previous registration was unverified. A fresh 6-digit OTP code has been sent to your email.",
      });
    }

    // 2. Hash password and create user in database
    const hashedPassword = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        avatar: avatar || null,
        role: role || "USER",
        sellerStatus: role === "MEMBER" ? "PENDING" : "APPROVED",
        isVerified: false,
      },
    });

    // 3. Generate and send OTP verification code to email
    const otpResult = await sendOtpEmail({ userId: newUser.id, email: newUser.email, purpose: "REGISTRATION" });
    if (!otpResult.success) {
      return otpDeliveryFailure(otpResult);
    }

    return NextResponse.json({
      success: true,
      requiresOtp: true,
      email: newUser.email,
      message: "Account created! A 6-digit OTP code has been sent to your email.",
    });
  } catch (error) {
    if (error instanceof PasswordWorkloadBusy) return NextResponse.json({ success: false, message: error.message }, { status: 503, headers: { "Retry-After": "5" } });
    return accountErrorResponse(error);
  }
}
