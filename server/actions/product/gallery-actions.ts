"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { productMediaStore, ProductMediaError } from "@/lib/cloudflare/r2";
import { replaceGallerySchema } from "@/lib/validations/product-gallery";
import { enqueueDetachedImages } from "@/lib/product-image-lifecycle";
import { AccountRequestError, limitAccountIp, limitAccountIdentity } from "@/lib/account-request";

export async function replaceProductGallery(input: unknown) {
  const actor = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
  if (!actor || (actor.role.toUpperCase() === "MEMBER" && actor.sellerStatus !== "APPROVED")) return { success: false as const, error: "Approved owner access is required." };
  const parsed = replaceGallerySchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the gallery selection." };
  try {
    const data = parsed.data;
    const initial = await prisma.product.findFirst({ where: { id: data.productId, sellerId: actor.id }, select: { mediaVersion: true } });
    if (!initial) return { success: false as const, error: "Product not found in your catalog." };
    if (initial.mediaVersion !== data.version) return { success: false as const, error: "Gallery changed. Reload before editing." };
    await limitAccountIp({ headers: await headers() }, "product-gallery", 10); await limitAccountIdentity(actor.id, "product-gallery", 10, 60);
    const store = productMediaStore();
    const uploadKeys = data.items.flatMap((item) => item.source === "upload" ? [item.key] : []);
    // Owned-type validation inside verify rejects foreign keys before R2 calls.
    const verified = uploadKeys.length ? await store.verify(uploadKeys, actor.id) : [];
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sellerStatus: true, sessionVersion: true } });
      if (!current?.isVerified || current.sessionVersion !== actor.sessionVersion || !["MEMBER", "ADMIN"].includes(current.role.toUpperCase()) || (current.role.toUpperCase() === "MEMBER" && current.sellerStatus !== "APPROVED")) throw new ProductMediaError("Seller access changed. Sign in again.");
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${data.productId} FOR UPDATE`;
      const product = await tx.product.findUnique({ where: { id: data.productId } });
      if (!product || product.sellerId !== actor.id) throw new ProductMediaError("Product not found in your catalog.");
      if (product.mediaVersion !== data.version) throw new ProductMediaError("Gallery changed. Reload before editing.");
      const previous = [...new Set([...(product.imageUrl ? [product.imageUrl] : []), ...product.images])];
      for (const item of data.items) if (item.source === "existing" && !previous.includes(item.url)) throw new ProductMediaError("Keep only images currently saved on this product.");
      const urls = verified.length ? await store.assertPresent(verified, actor.id) : [];
      const byKey = new Map(verified.map((image, index) => [image.key, urls[index]]));
      const images = data.items.map((item) => item.source === "existing" ? item.url : byKey.get(item.key)!);
      if (new Set(images).size !== images.length) throw new ProductMediaError("Choose distinct gallery images.");
      if (images.length === product.images.length && images.every((image, index) => image === product.images[index]) && images[0] === product.imageUrl) return { id: product.id, slug: product.slug, version: product.mediaVersion, changed: false, cleanupQueued: 0 };
      const cleanupQueued = await enqueueDetachedImages(tx, actor.id, previous, images);
      await tx.product.update({ where: { id: product.id }, data: { imageUrl: images[0], images, mediaVersion: { increment: 1 }, status: "PENDING_APPROVAL" } });
      return { id: product.id, slug: product.slug, version: product.mediaVersion + 1, changed: true, cleanupQueued };
    }, { timeout: 15_000, maxWait: 5000 });
    try { for (const path of ["/", "/products", "/admin/products", "/member/dashboard", `/products/${encodeURIComponent(saved.slug)}`, `/member/products/${saved.id}/images`]) revalidatePath(path); }
    catch { console.error("Committed product gallery cache refresh unavailable."); }
    return { success: true as const, data: saved };
  } catch (error) {
    return { success: false as const, error: error instanceof ProductMediaError || error instanceof AccountRequestError ? error.message : "Unable to save gallery. Your saved images remain available; reload before retrying." };
  }
}
