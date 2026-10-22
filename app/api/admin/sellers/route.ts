import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentUserWithRole } from "@/lib/session";
import { z } from "zod";

const updateSellerSchema = z.object({
  sellerId: z.string().min(1),
  sellerStatus: z.enum(["APPROVED", "BLOCKED", "PENDING", "REJECTED"]),
});

export async function POST(req: Request) {
  try {
    if (!(await getCurrentUserWithRole(["ADMIN"]))) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const parsed = updateSellerSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "Invalid seller status update." }, { status: 400 });
    }
    const { sellerId, sellerStatus } = parsed.data;

    const seller = await prisma.user.findUnique({ where: { id: sellerId }, select: { role: true } });
    if (!seller || seller.role !== "MEMBER") {
      return NextResponse.json({ success: false, message: "Seller not found" }, { status: 404 });
    }

    const user = await prisma.user.update({
      where: { id: sellerId },
      data: { sellerStatus },
      select: { id: true, email: true, name: true, role: true, sellerStatus: true },
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
