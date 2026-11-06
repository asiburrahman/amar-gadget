import { isPublicProductImageUrl, isPublicStorageOrigin, productImageNeedsDirectDelivery, publicProductMedia } from "@/lib/product-media-policy";
import { ownedImageKey } from "@/lib/product-image-keys";
it("accepts public CDN origins and rejects private S3 endpoints and non-origin configuration", () => {
  expect(isPublicStorageOrigin("https://cdn.example.invalid")).toBe(true);
  for (const value of ["http://cdn.example.invalid", "https://a.r2.cloudflarestorage.com", "https://a.r2.cloudflarestorage.com/bucket", "https://cdn.example.invalid?secret=x", "https://user:pass@cdn.example.invalid"]) expect(isPublicStorageOrigin(value)).toBe(false);
});
it("filters signed storage URLs before public serialization and serves custom CDN images directly", () => {
  const signed = "https://cdn.example.invalid/product.png?X-Amz-Signature=private";
  for (const value of [signed, "https://a.r2.cloudflarestorage.com/bucket/image.png", "javascript:alert(1)", "//evil.invalid/image.png", "data:image/png;base64,AAAA"]) expect(isPublicProductImageUrl(value)).toBe(false);
  expect(publicProductMedia({ imageUrl: signed, images: [signed, "https://cdn.example.invalid/image.png", "/images/product.png"] })).toEqual({ imageUrl: null, images: ["https://cdn.example.invalid/image.png", "/images/product.png"] });
  expect(productImageNeedsDirectDelivery("https://cdn.example.invalid/image.png")).toBe(true);
  expect(productImageNeedsDirectDelivery("https://images.unsplash.com/photo.jpg")).toBe(false);
});
it("recognizes only exact owner immutable keys across historical public origins", () => {
  const key = "products/owner/00000000-0000-4000-8000-000000000001.png";
  expect(ownedImageKey(`https://old.example.invalid/${key}`, "owner")).toBe(key);
  for (const value of [`https://cdn.example.invalid/${key}?token=x`, `https://cdn.example.invalid/${key}#x`, `https://cdn.example.invalid/${key.replace("owner", "other")}`, "https://cdn.example.invalid/arbitrary.png"]) expect(ownedImageKey(value, "owner")).toBeNull();
});
