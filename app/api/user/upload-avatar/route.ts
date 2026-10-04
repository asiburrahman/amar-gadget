import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwtToken } from "@/lib/auth";
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

    const userId = payload.sub as string;

    const contentType = req.headers.get("content-type") || "";

    let avatarDataUrl = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { success: false, message: "No image file provided." },
          { status: 400 }
        );
      }

      // Check mime type
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { success: false, message: "Only image files (JPG, PNG, WebP) are allowed." },
          { status: 400 }
        );
      }

      // 5MB limit
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { success: false, message: "Image size must be less than 5MB." },
          { status: 400 }
        );
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const mime = file.type || "image/jpeg";
      avatarDataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    } else {
      const body = await req.json();
      if (!body.avatar || typeof body.avatar !== "string") {
        return NextResponse.json(
          { success: false, message: "Invalid image data." },
          { status: 400 }
        );
      }
      avatarDataUrl = body.avatar;
    }

    // Update avatar in Database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarDataUrl },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        phone: true,
        isVerified: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Profile image uploaded and updated successfully!",
      avatar: updatedUser.avatar,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error("POST /api/user/upload-avatar error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to upload avatar." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
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

    await prisma.user.update({
      where: { id: payload.sub as string },
      data: { avatar: null },
    });

    return NextResponse.json({
      success: true,
      message: "Profile photo removed successfully.",
    });
  } catch (error: any) {
    console.error("DELETE /api/user/upload-avatar error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to remove avatar." },
      { status: 500 }
    );
  }
}
