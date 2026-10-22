"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentUserWithRole } from "@/lib/session";

export async function getAdminStats() {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return {
      success: false,
      stats: { totalUsers: 0, totalProducts: 0, pendingProducts: 0, totalOrders: 0, totalRevenue: 0 },
    };
  }

  try {
    const [totalUsers, totalProducts, pendingProducts, totalOrders, aggregateRevenue] = await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.product.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { paymentStatus: "PAID" },
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
    console.error("Failed to load admin statistics:", error);
    return {
      success: false,
      error: "Failed to load admin statistics.",
      stats: { totalUsers: 0, totalProducts: 0, pendingProducts: 0, totalOrders: 0, totalRevenue: 0 },
    };
  }
}

export async function updateProductStatus(productId: string, status: "APPROVED" | "REJECTED" | "PENDING_APPROVAL") {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return { success: false, error: "Unauthorized" };
  }

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

export async function updateSellerStatus(sellerId: string, sellerStatus: "APPROVED" | "BLOCKED" | "PENDING" | "REJECTED") {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { role: true },
    });
    if (!seller || seller.role !== "MEMBER") {
      return { success: false, error: "Seller not found." };
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

    return { success: true, data: user };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to update seller status" };
  }
}

export async function adminUpdateProductPrice(productId: string, price: number, discountPrice?: number | null) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        price,
        discountPrice: discountPrice !== undefined ? discountPrice : null,
      },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/products");
    revalidatePath("/products");
    revalidatePath(`/products/${product.slug}`);

    return { success: true, data: product };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to update product price" };
  }
}

export async function adminDeleteProduct(productId: string) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    await prisma.product.delete({
      where: { id: productId },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/products");
    revalidatePath("/member/dashboard");
    revalidatePath("/products");

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to delete product" };
  }
}
