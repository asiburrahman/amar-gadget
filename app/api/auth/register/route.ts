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

    const { name, email, password, role, avatar } = validated.data;

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return NextResponse.json(
        {
          success: false,
          message: "An account with this email address already exists.",
        },
        { status: 409 }
      );
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
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error during registration." },
      { status: 500 }
    );
  }
}