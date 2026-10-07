import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/auth";
import { hashPassword } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/mail/send-otp";

export async function POST(req: Request) {
  try {
    const body = await req.json();
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
      const hashedPassword = hashPassword(password);
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name,
          password: hashedPassword,
          avatar: avatar || existingUser.avatar,
          role: role || existingUser.role,
        },
      });

      // Dispatch fresh OTP verification email
      await sendOtpEmail(existingUser.email);

      return NextResponse.json({
        success: true,
        requiresOtp: true,
        email: existingUser.email,
        message: "Your previous registration was unverified. A fresh 6-digit OTP code has been sent to your email.",
      });
    }

    // 2. Hash password and create user in database
    const hashedPassword = hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        avatar: avatar || null,
        role: role || "USER",
        isVerified: false,
      },
    });

    // 3. Generate and send OTP verification code to email
    await sendOtpEmail(newUser.email);

    return NextResponse.json({
      success: true,
      requiresOtp: true,
      email: newUser.email,
      message: "Account created! A 6-digit OTP code has been sent to your email.",
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { 
        success: false, 
        message: "Internal server error during registration.",
        detail: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}