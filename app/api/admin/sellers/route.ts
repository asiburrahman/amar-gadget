import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function POST(req: Request) {
  try {
    const { sellerId, sellerStatus } = await req.json();

    if (!sellerId || !sellerStatus) {
      return NextResponse.json({ success: false, message: "Missing sellerId or sellerStatus" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: sellerId },
      data: { sellerStatus },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/sellers");
    revalidatePath("/member/dashboard");
    revalidatePath("/products");

    return NextResponse.json({ success: true, user });
  } catch (error: any) {
    console.error("API update seller status error:", error);
    return NextResponse.json({ success: false, message: error.message || "Failed to update seller status" }, { status: 500 });
  }
}
