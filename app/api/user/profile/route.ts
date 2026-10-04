import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJwtToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
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

    const user = await prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        role: true,
        sellerStatus: true,
        isVerified: true,
        createdAt: true,
        addresses: {
          orderBy: { isDefault: "desc" },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    console.error("GET /api/user/profile error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to load profile" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
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

    const body = await req.json();
    const { name, phone, avatar, address } = body;

    const userId = payload.sub as string;

    // Update user basic profile fields
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(typeof name === "string" && { name: name.trim() }),
        ...(typeof phone === "string" && { phone: phone.trim() }),
        ...(typeof avatar === "string" && { avatar: avatar.trim() }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        role: true,
        sellerStatus: true,
        isVerified: true,
        createdAt: true,
      },
    });

    // Update or create default address if address information is provided
    if (address && (address.street || address.city || address.district)) {
      const defaultAddress = await prisma.address.findFirst({
        where: { userId, isDefault: true },
      });

      if (defaultAddress) {
        await prisma.address.update({
          where: { id: defaultAddress.id },
          data: {
            fullName: address.fullName || updatedUser.name || "Default Customer",
            phone: address.phone || updatedUser.phone || "",
            street: address.street || "",
            city: address.city || "",
            district: address.district || "",
            zipCode: address.zipCode || null,
          },
        });
      } else {
        await prisma.address.create({
          data: {
            userId,
            fullName: address.fullName || updatedUser.name || "Default Customer",
            phone: address.phone || updatedUser.phone || "",
            street: address.street || "",
            city: address.city || "",
            district: address.district || "",
            zipCode: address.zipCode || null,
            isDefault: true,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully!",
      user: updatedUser,
    });
  } catch (error: any) {
    console.error("PUT /api/user/profile error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to update profile." },
      { status: 500 }
    );
  }
}
