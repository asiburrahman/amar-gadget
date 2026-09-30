import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ success: false, message: "Product slug is required" }, { status: 400 });
    }

    let product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true, email: true } },
        reviews: {
          include: { user: { select: { name: true, avatar: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!product) {
      product = await prisma.product.findUnique({
        where: { id: slug },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          seller: { select: { id: true, name: true, email: true } },
          reviews: {
            include: { user: { select: { name: true, avatar: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }

    if (!product) {
      product = await prisma.product.findFirst({
        where: { slug: { equals: slug, mode: "insensitive" } },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          seller: { select: { id: true, name: true, email: true } },
          reviews: {
            include: { user: { select: { name: true, avatar: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }

    if (!product) {
      return NextResponse.json(
        { success: false, message: "Product not found in database" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      product,
    });
  } catch (error: any) {
    console.error("API /api/products/[slug] error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
