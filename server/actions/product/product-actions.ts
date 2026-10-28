"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { createProductSchema, productQuerySchema, type CreateProductInput } from "@/lib/validations/product";
import { revalidatePath } from "next/cache";
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";

export async function getProducts(queryParams: Record<string, unknown> = {}) {
  try {
    const parsed = productQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return { success: false, error: "Invalid query parameters", data: [], total: 0 };
    }

    const { page, limit, search, categoryId, brandId, minPrice, maxPrice, status, sort } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};
    if (!status || status === "APPROVED") {
      Object.assign(where, publicProductWhere);
    } else {
      const viewer = await getCurrentUser();
      if (!viewer) {
        return { success: false, error: "Unauthorized", data: [], total: 0 };
      }
      if (viewer.role.toUpperCase() === "ADMIN") {
        where.status = status;
      } else if (
        viewer.role.toUpperCase() === "MEMBER" &&
        viewer.sellerStatus === "APPROVED"
      ) {
        where.status = status;
        where.sellerId = viewer.id;
      } else {
        return { success: false, error: "Unauthorized", data: [], total: 0 };
      }
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (brandId) {
      where.brandId = brandId;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    let orderBy: any = { createdAt: "desc" };
    if (sort === "price_low") orderBy = { price: "asc" };
    if (sort === "price_high") orderBy = { price: "desc" };
    if (sort === "rating") orderBy = { rating: "desc" };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          brand: { select: { id: true, name: true, slug: true, logo: true } },
          seller: { select: { id: true, name: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return {
      success: true,
      data: products.map((p) => ({
        ...p,
        price: Number(p.price),
        discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
      })),
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  } catch (error: any) {
    console.error("Error fetching products:", error);
    return { success: false, error: "Failed to fetch products", data: [], total: 0 };
  }
}

export async function getProductBySlug(slug: string) {
  try {
    const product = await prisma.product.findFirst({
      where: { slug, ...publicProductWhere },
      include: {
        category: true,
        brand: true,
        seller: { select: { id: true, name: true } },
        reviews: {
          include: { user: { select: { name: true, avatar: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!product) return { success: false, error: "Product not found", data: null };

    return {
      success: true,
      data: {
        ...product,
        price: Number(product.price),
        discountPrice: product.discountPrice ? Number(product.discountPrice) : null,
      },
    };
  } catch (error) {
    return { success: false, error: "Error fetching product", data: null };
  }
}

export async function createProduct(input: CreateProductInput) {
  try {
    const targetSeller = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
    if (!targetSeller) {
      return { success: false, error: "Unauthorized" };
    }

    if (targetSeller.role.toUpperCase() === "MEMBER" && targetSeller.sellerStatus !== "APPROVED") {
      return {
        success: false,
        error: "Your seller account is currently pending Admin Approval or suspended. You cannot submit products until approved.",
      };
    }

    const validated = createProductSchema.parse(input);
    const slug = validated.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now();

    const product = await prisma.product.create({
      data: {
        name: validated.name,
        slug,
        description: validated.description,
        price: validated.price,
        discountPrice: validated.discountPrice ?? null,
        stock: validated.stock,
        imageUrl: validated.imageUrl || "/images/product-placeholder.png",
        images: validated.images || [],
        categoryId: validated.categoryId,
        brandId: validated.brandId || null,
        sellerId: targetSeller.id,
        status: "PENDING_APPROVAL",
        isFeatured: validated.isFeatured || false,
      },
    });

    revalidatePath("/products");
    revalidatePath("/member/dashboard");
    revalidatePath("/admin");
    revalidatePath("/admin/products");

    return { success: true, data: product };
  } catch (error: any) {
    console.error("Error creating product:", error);
    return { success: false, error: error.message || "Failed to create product" };
  }
}

export async function getCategories() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: { where: publicProductWhere } } } },
    });
    return { success: true, data: categories };
  } catch (error) {
    return { success: false, data: [] };
  }
}

export async function getBrands() {
  try {
    const brands = await prisma.brand.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: { where: publicProductWhere } } } },
    });
    return { success: true, data: brands };
  } catch (error) {
    return { success: false, data: [] };
  }
}
