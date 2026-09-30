import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FALLBACK_PRODUCTS } from "@/lib/mock-catalog";

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

    let products: any[] = [];
    let total = 0;

    try {
      [products, total] = await Promise.all([
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
    } catch (dbErr) {
      console.error("Database query failed in /api/products:", dbErr);
    }

    // Fallback if database returns no records
    if (!products || products.length === 0) {
      let filtered = [...FALLBACK_PRODUCTS];

      if (search) {
        const query = search.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.description.toLowerCase().includes(query)
        );
      }

      if (categoryId) {
        const catQuery = categoryId.toLowerCase();
        filtered = filtered.filter((p) =>
          p.category.name.toLowerCase().includes(catQuery)
        );
      }

      total = filtered.length;
      products = filtered.slice(skip, skip + limit);
    }

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
        message: "Failed to retrieve products",
        products: FALLBACK_PRODUCTS.slice(0, 10),
      },
      { status: 500 }
    );
  }
}