export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProductImageType = typeof PRODUCT_IMAGE_TYPES[number];
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 8;
export const IMAGE_EXTENSIONS: Record<ProductImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export function isStorageApiHost(hostname: string) { return hostname === "r2.cloudflarestorage.com" || hostname.endsWith(".r2.cloudflarestorage.com"); }
export function isPublicStorageOrigin(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" && !isStorageApiHost(url.hostname); } catch { return false; }
}
export function isPublicProductImageUrl(value: string) {
  if (!value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/")) return /^\/(?:images\/|assets\/)?[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/.test(value) && !/(?:^|\/)\.\.(?:\/|$)/.test(value) && !value.startsWith("//");
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash && !isStorageApiHost(url.hostname) && ![...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("x-amz-")); } catch { return false; }
}
export function publicProductMedia(product: { imageUrl: string | null; images: string[] }) {
  return { imageUrl: product.imageUrl && isPublicProductImageUrl(product.imageUrl) ? product.imageUrl : null, images: product.images.filter(isPublicProductImageUrl) };
}

/** Preserve the build's existing optimized hosts; runtime-only custom R2
 * domains use their CDN directly without opening the server image proxy. */
export function productImageNeedsDirectDelivery(src: string) {
  if (src.startsWith("/") && !src.startsWith("//")) return false;
  try {
    const url = new URL(src);
    return !(url.protocol === "https:" && !url.port && (url.hostname.endsWith(".unsplash.com") || url.hostname.endsWith(".r2.dev")));
  } catch { return true; }
}

export function validateProductImage(file: { size: number; type: string }) {
  if (!PRODUCT_IMAGE_TYPES.includes(file.type as ProductImageType)) return "Choose a JPEG, PNG or WebP image.";
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_PRODUCT_IMAGE_BYTES) return "Each image must be between 1 byte and 5 MiB.";
  return null;
}
