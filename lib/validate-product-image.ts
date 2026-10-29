import sharp from "sharp";
import type { ProductImageType } from "@/lib/product-media-policy";

export async function decodeProductImage(bytes: Buffer, type: ProductImageType) {
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 16_000_000, limitInputChannels: 4, sequentialRead: true }).timeout({ seconds: 5 });
  try {
    const metadata = await decoder.metadata();
    const format = type === "image/jpeg" ? "jpeg" : type === "image/png" ? "png" : "webp";
    if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > 16_000_000 || (metadata.pages ?? 1) !== 1) throw new Error("Invalid raster dimensions or format");
    // metadata() alone does not decode pixels; stats() detects truncated or
    // corrupt raster data without retaining a full decoded output buffer.
    await decoder.stats();
  } finally { decoder.destroy(); }
}
