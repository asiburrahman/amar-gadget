import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import { verifyPassword, hashPassword, passwordNeedsRehash, PasswordWorkloadBusy, signJwtToken } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { otpDeliveryFailure } from "@/lib/otp-response";

export async function POST(req: Request) {
  try {
    const limit = await rateLimit(getClientIp(req.headers), 10, 60, "auth-login");
    if (!limit.success) {
      return NextResponse.json({ success: false, message: "Too many sign-in attempts. Try again shortly." }, { status: 429 });
    }

    const body = await req.json();
    const validated = loginSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid input payload",
          errors: validated.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { email, password } = validated.data;

    // 1. Retrieve user from database
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!(await verifyPassword(password, user?.password)) || !user?.password) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid email address or password.",
        },
        { status: 401 }
      );
    }

    if (passwordNeedsRehash(user.password)) {
      const upgraded = await hashPassword(password);
      const saved = await prisma.user.updateMany({ where: { id: user.id, password: user.password }, data: { password: upgraded } });
      // Never overwrite a concurrent password reset. Another successful login
      // may already have upgraded this same password, so recheck that case.
      if (saved.count !== 1) {
        const current = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
        if (!(await verifyPassword(password, current?.password))) return NextResponse.json({ success: false, message: "Invalid email address or password." }, { status: 401 });
      }
    }

    // 2.5 Check if user is verified
    if (!user.isVerified) {
      // Send fresh OTP to the unverified user
      const otpResult = await sendOtpEmail({ userId: user.id, email: user.email, purpose: "REGISTRATION" });
      if (!otpResult.success) {
        return otpDeliveryFailure(otpResult);
      }
      return NextResponse.json(
        {
          success: false,
          requiresOtp: true,
          email: user.email,
          message: "Your account is not verified yet. A 6-digit verification code has been sent to your email. Please verify to sign in.",
        },
        { status: 403 }
      );
    }

    // 3. Generate signed JWT token
    const token = await signJwtToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    // 4. Attach HTTP-only auth_token cookie
    const response = NextResponse.json({
      success: true,
      message: "Login successful!",
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
    if (error instanceof PasswordWorkloadBusy) return NextResponse.json({ success: false, message: error.message }, { status: 503, headers: { "Retry-After": "5" } });
    console.error("Login error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error during login.",
      },
      { status: 500 }
    );
  }
}
