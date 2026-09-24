"use server";

import { prisma } from "@/lib/prisma";
import { createProductSchema, productQuerySchema, type CreateProductInput } from "@/lib/validations/product";
import { revalidatePath } from "next/cache";

export async function getProducts(queryParams: Record<string, unknown> = {}) {
  try {
    const parsed = productQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return { success: false, error: "Invalid query parameters", data: [], total: 0 };
    }

    const { page, limit, search, categoryId, brandId, minPrice, maxPrice, status, sort } = parsed.data;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    } else {
      // Default to APPROVED for public catalog
      where.status = "APPROVED";
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
          seller: { select: { id: true, name: true, email: true } },
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
    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        brand: true,
        seller: { select: { id: true, name: true, email: true } },
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

export async function createProduct(input: CreateProductInput, sellerId: string) {
  try {
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
        sellerId,
        status: "PENDING_APPROVAL",
        isFeatured: validated.isFeatured || false,
      },
    });

    revalidatePath("/products");
    revalidatePath("/member/products");
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
      include: { _count: { select: { products: true } } },
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
      include: { _count: { select: { products: true } } },
    });
    return { success: true, data: brands };
  } catch (error) {
    return { success: false, data: [] };
  }
}
