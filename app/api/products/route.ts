import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || searchParams.get("q") || "";
    const categoryId = searchParams.get("categoryId") || searchParams.get("category");
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const skip = (page - 1) * limit;

    const whereClause: any = {
      status: "APPROVED",
      seller: {
        sellerStatus: "APPROVED",
      },
    };

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (categoryId) {
      whereClause.OR = [
        { categoryId: categoryId },
        { category: { name: { contains: categoryId, mode: "insensitive" } } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: whereClause,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          seller: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: skip,
      }),
      prisma.product.count({ where: whereClause }),
    ]);

    return NextResponse.json({
      success: true,
      total,
      page,
      limit,
      products,
    });
  } catch (error: any) {
    console.error("API /api/products error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to retrieve products from database",
        products: [],
      },
      { status: 500 }
    );
  }
}