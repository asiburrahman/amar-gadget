export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProductImageType = typeof PRODUCT_IMAGE_TYPES[number];
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 8;
export const IMAGE_EXTENSIONS: Record<ProductImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Preserve the build's existing optimized hosts; runtime-only custom R2
 * domains use their CDN directly without opening the server image proxy. */
export function productImageNeedsDirectDelivery(src: string) {
  if (src.startsWith("/") && !src.startsWith("//")) return false;
  try {
    const url = new URL(src);
    return !(url.protocol === "https:" && (url.hostname.endsWith(".unsplash.com") || url.hostname.endsWith(".r2.dev")));
  } catch { return true; }
}

export function validateProductImage(file: { size: number; type: string }) {
  if (!PRODUCT_IMAGE_TYPES.includes(file.type as ProductImageType)) return "Choose a JPEG, PNG or WebP image.";
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_PRODUCT_IMAGE_BYTES) return "Each image must be between 1 byte and 5 MiB.";
  return null;
}
