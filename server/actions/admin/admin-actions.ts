"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentUserWithRole } from "@/lib/session";
import { catalogIdSchema, productStatusUpdateSchema, productPriceUpdateSchema, productApprovalSchema, sellerStatusUpdateSchema } from "@/lib/validations/product";
import { CatalogMutationError, withCurrentAdmin } from "@/lib/catalog-mutations";
import { Prisma } from "@prisma/client";
import { isPublicAsset } from "@/lib/public-assets";
import { enqueueDetachedImages } from "@/lib/product-image-lifecycle";

function mutationError(error: unknown) {
  if (error instanceof CatalogMutationError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return "This record is referenced by other records and cannot be deleted.";
  console.error("Catalog mutation unavailable.");
  return "Unable to save this change. Try again later.";
}
function refreshCatalog(slug?: string) {
  for (const path of ["/", "/admin", "/admin/products", "/member/products", "/member/dashboard", "/products"]) revalidatePath(path);
  if (slug) revalidatePath(`/products/${slug}`);
}

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

export async function updateProductStatus(productId: unknown, status: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = productStatusUpdateSchema.safeParse({ productId, status });
  if (!parsed.success) return { success: false, error: "Invalid product identifier or status." };
  try {
    const product = await withCurrentAdmin(actor, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${parsed.data.productId} FOR UPDATE`;
      const existing = await tx.product.findUnique({ where: { id: parsed.data.productId }, include: { seller: { select: { role: true, sellerStatus: true, isVerified: true } } } });
      if (!existing) throw new CatalogMutationError("Product not found.");
      if (parsed.data.status === "APPROVED") {
        const valid = productApprovalSchema.safeParse({ name: existing.name, description: existing.description ?? undefined, specifications: existing.specifications, price: Number(existing.price), discountPrice: existing.discountPrice === null ? null : Number(existing.discountPrice), stock: existing.stock, categoryId: existing.categoryId, brandId: existing.brandId, isFeatured: existing.isFeatured, imageUrl: existing.imageUrl, images: existing.images });
        if (!valid.success) throw new CatalogMutationError("Correct the product fields and cover/gallery before approval.");
        if ([existing.imageUrl, ...existing.images].some((url) => url?.startsWith("/") && !isPublicAsset(url))) throw new CatalogMutationError("Local product images must exist in the public assets.");
        if (!existing.seller.isVerified || !["MEMBER", "ADMIN"].includes(existing.seller.role.toUpperCase()) || (existing.seller.role.toUpperCase() === "MEMBER" && existing.seller.sellerStatus !== "APPROVED")) throw new CatalogMutationError("The seller must be verified and approved before product approval.");
      }
      return tx.product.update({ where: { id: existing.id }, data: { status: parsed.data.status }, select: { id: true, slug: true, status: true } });
    });
    refreshCatalog(product.slug);
    return { success: true, data: product };
  } catch (error) {
    return { success: false, error: mutationError(error) };
  }
}

export async function updateSellerStatus(sellerId: unknown, sellerStatus: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = sellerStatusUpdateSchema.safeParse({ sellerId, sellerStatus });
  if (!parsed.success) return { success: false, error: "Invalid seller identifier or status." };
  try {
    const user = await withCurrentAdmin(actor, async (tx) => {
      const seller = await tx.user.findUnique({ where: { id: parsed.data.sellerId }, select: { role: true } });
      if (!seller || seller.role.toUpperCase() !== "MEMBER") throw new CatalogMutationError("Seller not found.");
      const updated = await tx.user.updateMany({ where: { id: parsed.data.sellerId, role: seller.role }, data: { sellerStatus: parsed.data.sellerStatus } });
      if (updated.count !== 1) throw new CatalogMutationError("Seller access changed. Refresh before retrying.");
      return tx.user.findUniqueOrThrow({ where: { id: parsed.data.sellerId }, select: { id: true, email: true, name: true, role: true, sellerStatus: true } });
    });

    revalidatePath("/admin");
    revalidatePath("/admin/sellers");
    revalidatePath("/member/dashboard");
    revalidatePath("/products");

    return { success: true, data: user };
  } catch (error) {
    return { success: false, error: mutationError(error) };
  }
}

export async function adminUpdateProductPrice(productId: unknown, price: unknown, discountPrice?: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = productPriceUpdateSchema.safeParse({ productId, price, discountPrice });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || "Invalid product price." };
  try {
    const product = await withCurrentAdmin(actor, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true } });
      if (!existing) throw new CatalogMutationError("Product not found.");
      return tx.product.update({ where: { id: existing.id }, data: { price: parsed.data.price, discountPrice: parsed.data.discountPrice ?? null }, select: { id: true, slug: true, price: true, discountPrice: true } });
    });

    refreshCatalog(product.slug);
    return { success: true, data: { id: product.id, slug: product.slug, price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice) } };
  } catch (error) {
    return { success: false, error: mutationError(error) };
  }
}

export async function adminDeleteProduct(productId: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = catalogIdSchema.safeParse(productId);
  if (!parsed.success) return { success: false, error: "Invalid product identifier." };
  try {
    const snapshot = await prisma.product.findUnique({ where: { id: parsed.data }, select: { sellerId: true } });
    if (!snapshot) return { success: false, error: "Product not found." };
    const product = await withCurrentAdmin(actor, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: parsed.data }, select: { id: true, slug: true, sellerId: true, imageUrl: true, images: true } });
      if (!existing) throw new CatalogMutationError("Product not found.");
      if (existing.sellerId !== snapshot.sellerId) throw new CatalogMutationError("Product changed. Reload before deleting.");
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${existing.id} FOR UPDATE`;
      const current = await tx.product.findUnique({ where: { id: existing.id }, select: { sellerId: true, imageUrl: true, images: true } });
      if (!current || current.sellerId !== existing.sellerId) throw new CatalogMutationError("Product changed. Reload before deleting.");
      await enqueueDetachedImages(tx, current.sellerId, [...(current.imageUrl ? [current.imageUrl] : []), ...current.images], []);
      await tx.product.delete({ where: { id: existing.id } });
      return existing;
    }, [snapshot.sellerId]);

    try { refreshCatalog(product.slug); } catch { console.error("Committed product deletion cache refresh unavailable."); }
    return { success: true };
  } catch (error) {
    return { success: false, error: mutationError(error) };
  }
}
