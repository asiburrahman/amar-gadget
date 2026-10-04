import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwtToken, verifyPassword, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

    const { currentPassword, newPassword, confirmPassword } = await req.json();

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "New password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "New password and confirmation do not match." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: { id: true, password: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    // If user has an existing password, verify it
    if (user.password) {
      if (!currentPassword) {
        return NextResponse.json(
          { success: false, message: "Current password is required." },
          { status: 400 }
        );
      }

      const isCurrentValid = verifyPassword(currentPassword, user.password);
      if (!isCurrentValid) {
        return NextResponse.json(
          { success: false, message: "Current password is incorrect." },
          { status: 400 }
        );
      }
    }

    // Hash and update to new password
    const hashed = hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully!",
    });
  } catch (error: any) {
    console.error("POST /api/user/change-password error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to update password." },
      { status: 500 }
    );
  }
}
