import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || searchParams.get("q") || "";
    const categoryId = searchParams.get("categoryId") || searchParams.get("category");
    const requestedLimit = Number(searchParams.get("limit") || "20");
    const requestedPage = Number(searchParams.get("page") || "1");
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
    const page = Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
    const skip = (page - 1) * limit;

    const whereClause: Prisma.ProductWhereInput = {
      status: "APPROVED",
      seller: { sellerStatus: "APPROVED" },
    };
    const filters: Prisma.ProductWhereInput[] = [];

    if (search) {
      filters.push({ OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ] });
    }

    if (categoryId) {
      filters.push({ OR: [
        { categoryId: categoryId },
        { category: { name: { contains: categoryId, mode: "insensitive" } } },
      ] });
    }
    if (filters.length) whereClause.AND = filters;

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