import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json(
      { success: false, message: "A product ID is required." },
      { status: 400 }
    );
  }

  try {
    const reviews = await prisma.review.findMany({
      where: {
        productId,
        product: { status: "APPROVED", seller: { sellerStatus: "APPROVED" } },
      },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: { select: { name: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ success: true, reviews });
  } catch (error) {
    console.error("Review listing failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load reviews." }, { status: 500 });
  }
}
