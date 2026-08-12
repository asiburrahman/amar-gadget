import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import { verifyPassword, signJwtToken } from "@/lib/auth";

export async function POST(req: Request) {
  try {
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

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid email address or password.",
        },
        { status: 401 }
      );
    }

    // 2. Verify password (if stored password exists)
    if (!user.password || !verifyPassword(password, user.password)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid email address or password.",
        },
        { status: 401 }
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
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error during login." },
      { status: 500 }
    );
  }
}