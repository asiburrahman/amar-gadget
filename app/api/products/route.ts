import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { Prisma } from "@prisma/client";
import { resolveCatalogBrand } from "@/lib/catalog-brand-filter";
import { brandQueryValues } from "@/lib/validations/catalog-brand";

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
    const selected = brandQueryValues(searchParams);
    const brandFilter = await resolveCatalogBrand(selected.brand, selected.brandId);
    if (brandFilter.state === "invalid") return NextResponse.json({ success: false, message: brandFilter.message, products: [], total: 0, page, limit, brandFilter }, { status: 400 });
    if (brandFilter.state === "missing") return NextResponse.json({ success: true, products: [], total: 0, page, limit, brandFilter, message: "Brand not found." });

    const whereClause: Prisma.ProductWhereInput = {
      ...publicProductWhere,
    };
    const filters: Prisma.ProductWhereInput[] = [];
    if (brandFilter.state === "found") whereClause.brandId = brandFilter.brand.id;

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
          brand: { select: { id: true, name: true, slug: true } },
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
      brandFilter,
    });
  } catch {
    console.error("Public catalog query unavailable.");
    return NextResponse.json(
      {
        success: false,
        message: "Products are temporarily unavailable. Try again later.",
        products: [],
      },
      { status: 503 }
    );
  }
}
