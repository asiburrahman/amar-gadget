"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getAdminStats() {
  try {
    const [totalUsers, totalProducts, pendingProducts, totalOrders, aggregateRevenue] = await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.product.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { total: true },
      }),
    ]);

    return {
      success: true,
      stats: {
        totalUsers,
        totalProducts,
        pendingProducts,
        totalOrders,
        totalRevenue: Number(aggregateRevenue._sum.total || 0),
      },
    };
  } catch (error) {
    return {
      success: false,
      stats: { totalUsers: 0, totalProducts: 0, pendingProducts: 0, totalOrders: 0, totalRevenue: 0 },
    };
  }
}

export async function updateProductStatus(productId: string, status: "APPROVED" | "REJECTED" | "PENDING_APPROVAL") {
  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data: { status },
    });

    revalidatePath("/admin/products");
    revalidatePath("/member/products");
    revalidatePath("/products");

    return { success: true, data: product };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to update product status" };
  }
}

export async function createCategory(name: string, image?: string) {
  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const category = await prisma.category.create({
      data: { name, slug, image: image || null },
    });
    revalidatePath("/admin/categories");
    return { success: true, data: category };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to create category" };
  }
}

export async function createBrand(name: string, logo?: string) {
  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const brand = await prisma.brand.create({
      data: { name, slug, logo: logo || null },
    });
    revalidatePath("/admin/brands");
    return { success: true, data: brand };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to create brand" };
  }
}
