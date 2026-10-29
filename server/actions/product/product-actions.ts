"use server";


import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { createProductSchema, productQuerySchema } from "@/lib/validations/product";
import { revalidatePath } from "next/cache";
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";
import { productMediaStore, ProductMediaError } from "@/lib/cloudflare/r2";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { AccountRequestError, limitAccountIp, limitAccountIdentity } from "@/lib/account-request";
import { getCatalogListing, CatalogQueryError, CatalogAccessError, type CatalogScope } from "@/lib/catalog-listing";
import { publicProductMedia } from "@/lib/product-media-policy";

export async function getProducts(queryParams: Record<string, unknown> = {}) {
  try {
    const parsed = productQuerySchema.safeParse(queryParams);
    if (!parsed.success) return { success: false, error: "Invalid query parameters", data: [], total: 0 };
    let scope: CatalogScope = { kind: "public" };
    const status = parsed.data.status;
    if (status && status !== "APPROVED") {
      const actor = await getCurrentUser();
      if (!actor) return { success: false, error: "Unauthorized", data: [], total: 0 };
      if (actor.role.toUpperCase() === "ADMIN") scope = { kind: "admin", status, actorId: actor.id, sessionVersion: actor.sessionVersion };
      else if (actor.role.toUpperCase() === "MEMBER" && actor.sellerStatus === "APPROVED") scope = { kind: "seller", status, actorId: actor.id, sessionVersion: actor.sessionVersion };
      else return { success: false, error: "Unauthorized", data: [], total: 0 };
    }
    const listing = await getCatalogListing(parsed.data, scope);
    return { success: true, data: listing.products, total: listing.total, totalPages: listing.totalPages, currentPage: listing.page, limit: listing.limit, brandFilter: listing.brandFilter, categoryFilter: listing.categoryFilter };
  } catch (error) {
    if (error instanceof CatalogAccessError) return { success: false, error: "Unauthorized", data: [], total: 0 };
    if (error instanceof CatalogQueryError) return { success: false, error: error.message, data: [], total: 0 };
    console.error("Product query is temporarily unavailable.");
    return { success: false, error: "Products are temporarily unavailable. Try again later.", data: [], total: 0 };
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
        ...publicProductMedia(product),
        price: Number(product.price),
        discountPrice: product.discountPrice ? Number(product.discountPrice) : null,
      },
    };
  } catch {
    return { success: false, error: "Error fetching product", data: null };
  }
}

export async function createProduct(input: unknown) {
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

    const parsed = createProductSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || "Invalid product fields.", errors: parsed.error.flatten().fieldErrors };
    const validated = parsed.data;
    if (validated.isFeatured && targetSeller.role.toUpperCase() !== "ADMIN") return { success: false, error: "Only an administrator can feature products." };
    // Persist only canonical verified object URLs, never caller-selected URLs
    // or inline image bytes. The first selected image is the cover.
    if (validated.imageUrl || validated.images.length) return { success: false, error: "Upload product images using the image picker." };
    await limitAccountIp({ headers: await headers() }, "product-create", 10);
    await limitAccountIdentity(targetSeller.id, "product-create", 10, 60);
    const [category, brand] = await Promise.all([
      prisma.category.findUnique({ where: { id: validated.categoryId }, select: { id: true } }),
      validated.brandId ? prisma.brand.findUnique({ where: { id: validated.brandId }, select: { id: true } }) : null,
    ]);
    if (!category || (validated.brandId && !brand)) return { success: false, error: "Select an existing category and brand." };
    const media = productMediaStore();
    const verified = await media.verify(validated.uploadKeys, targetSeller.id);
    const slug = (validated.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product") + "-" + randomUUID();

    const product = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetSeller.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: targetSeller.id }, select: { isVerified: true, role: true, sellerStatus: true, sessionVersion: true } });
      if (!current?.isVerified || current.sessionVersion !== targetSeller.sessionVersion || !["MEMBER", "ADMIN"].includes(current.role.toUpperCase()) || (current.role.toUpperCase() === "MEMBER" && current.sellerStatus !== "APPROVED")) throw new ProductMediaError("Your seller access changed. Sign in again before submitting.");
      // The cleanup operator takes the same owner lock: a selected old upload
      // either gets referenced here, or is removed before verification fails.
      const images = await media.assertPresent(verified, targetSeller.id);
      return tx.product.create({
        data: {
          name: validated.name,
          slug,
          description: validated.description,
          specifications: validated.specifications,
          price: validated.price,
          discountPrice: validated.discountPrice ?? null,
          stock: validated.stock,
          imageUrl: images[0],
          images,
          categoryId: validated.categoryId,
          brandId: validated.brandId || null,
          sellerId: targetSeller.id,
          status: "PENDING_APPROVAL",
          isFeatured: validated.isFeatured || false,
        },
      });
    }, { timeout: 15_000, maxWait: 5000 });

    revalidatePath("/products");
    revalidatePath("/member/dashboard");
    revalidatePath("/admin");
    revalidatePath("/admin/products");

    return { success: true, data: { id: product.id, slug: product.slug } };
  } catch (error: unknown) {
    if (error instanceof ProductMediaError) return { success: false, error: error.message };
    if (error instanceof AccountRequestError) return { success: false, error: error.message, retryAfter: error.retryAfter };
    console.error("Product creation failed.");
    return { success: false, error: "Unable to submit the product. Check the fields and uploaded images, then try again." };
  }
}

export async function getCategories() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: { where: publicProductWhere } } } },
    });
    return { success: true, data: categories };
  } catch {
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
  } catch {
    return { success: false, data: [] };
  }
}
