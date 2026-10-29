import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { readStorageConfig } from "@/config/runtime";
import { IMAGE_EXTENSIONS, MAX_PRODUCT_IMAGES, MAX_PRODUCT_IMAGE_BYTES, validateProductImage, isPublicStorageOrigin, type ProductImageType } from "@/lib/product-media-policy";
import { imageKeyOwner } from "@/lib/product-image-keys";
import { decodeProductImage } from "@/lib/validate-product-image";

export class ProductMediaError extends Error {}
type VerifiedImage = { key: string; url: string; type: ProductImageType; length: number; etag: string };
let activeVerifications = 0;

/** Dependency injection is for isolated SDK/HTTP tests; production always uses
 * the configured account's R2 endpoint, never a caller-selected host. */
export function createProductMediaStore(client: S3Client, bucket: string, publicBase: string) {
  if (!isPublicStorageOrigin(publicBase)) throw new ProductMediaError("Configure a public HTTPS media origin, not the S3 API endpoint.");
  const publicUrl = (key: string) => `${publicBase.replace(/\/$/, "")}/${key}`;
  const ownedType = (key: string, ownerId: string): ProductImageType => {
    const prefix = `products/${ownerId}/`;
    if (!key.startsWith(prefix) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/.test(key.slice(prefix.length))) throw new ProductMediaError("Select images uploaded by your account.");
    const extension = key.slice(key.lastIndexOf(".") + 1);
    return extension === "jpg" ? "image/jpeg" : extension === "png" ? "image/png" : "image/webp";
  };
  return {
    async list(cursor?: string) {
      const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "products/", MaxKeys: 100, ContinuationToken: cursor }), { abortSignal: AbortSignal.timeout(5000) });
      return { keys: (result.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []), cursor: result.NextContinuationToken };
    },
    async unusedCandidate(key: string) {
      const match = key.match(/^products\/([A-Za-z0-9-]{1,64})\/[^/]+$/);
      if (!match) return null;
      ownedType(key, match[1]);
      const object = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
      if (!object.LastModified || object.LastModified.getTime() > Date.now() - 24 * 60 * 60 * 1000) return null;
      return { ownerId: match[1], url: publicUrl(key) };
    },
    async removeUnused(key: string) {
      if (!imageKeyOwner(key)) throw new ProductMediaError("Invalid managed image key.");
      const candidate = await this.unusedCandidate(key);
      if (!candidate) throw new ProductMediaError("Only old unused managed images may be removed.");
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
    },
    async prepare({ ownerId, contentType, size }: { ownerId: string; contentType: ProductImageType; size: number }) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(ownerId) || validateProductImage({ type: contentType, size })) throw new ProductMediaError("Invalid product image.");
      const fileKey = `products/${ownerId}/${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
      const command = new PutObjectCommand({ Bucket: bucket, Key: fileKey, ContentType: contentType, ContentLength: size, IfNoneMatch: "*", CacheControl: "public, max-age=31536000, immutable" });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length", "if-none-match", "cache-control"]) });
      return { uploadUrl, fileKey, publicUrl: publicUrl(fileKey), expiresIn: 300, headers: { "Content-Type": contentType, "If-None-Match": "*", "Cache-Control": "public, max-age=31536000, immutable" } };
    },
    async verify(keys: string[], ownerId: string) {
      if (!keys.length || keys.length > MAX_PRODUCT_IMAGES || new Set(keys).size !== keys.length) throw new ProductMediaError("Select between one and eight distinct uploaded images.");
      // Validate every ownership reference before any provider access.
      const types = keys.map((key) => ownedType(key, ownerId));
      if (activeVerifications >= 2) throw new ProductMediaError("Image verification is busy. Try submitting again shortly.");
      activeVerifications++;
      const budget = AbortSignal.timeout(20_000);
      const result: VerifiedImage[] = [];
      try {
        // One image per request is buffered/decoded at a time, with two batches
        // maximum per process and no unbounded waiting queue.
        for (const [index, key] of keys.entries()) {
          const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.any([budget, AbortSignal.timeout(5000)]) });
          if (head.ContentType !== types[index] || !Number.isSafeInteger(head.ContentLength) || !head.ContentLength || head.ContentLength < 1 || head.ContentLength > MAX_PRODUCT_IMAGE_BYTES || !head.ETag) throw new ProductMediaError("An uploaded image has an invalid type or size. Upload it again.");
          const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: head.ETag }), { abortSignal: AbortSignal.any([budget, AbortSignal.timeout(5000)]) });
          if (object.ContentLength !== head.ContentLength || !object.Body) { await object.Body?.transformToWebStream().cancel().catch(() => undefined); throw new ProductMediaError("Unable to validate the uploaded image."); }
          const reader = object.Body.transformToWebStream().getReader();
          const chunks: Uint8Array[] = []; let length = 0;
          try {
            while (true) {
              const item = await reader.read(); if (item.done) break;
              length += item.value.byteLength;
              if (length > MAX_PRODUCT_IMAGE_BYTES || length > head.ContentLength) { await reader.cancel(); throw new ProductMediaError("Uploaded image exceeds the size limit."); }
              chunks.push(item.value);
            }
          } finally { reader.releaseLock(); }
          if (length !== head.ContentLength) throw new ProductMediaError("The image upload is incomplete. Upload it again.");
          try { await decodeProductImage(Buffer.concat(chunks, length), types[index]); }
          catch { throw new ProductMediaError("Use a complete, single-frame JPEG, PNG or WebP image up to 16 megapixels and 8192 pixels per side."); }
          budget.throwIfAborted();
          result.push({ key, url: publicUrl(key), type: types[index], length, etag: head.ETag });
        }
        return result;
      } finally { activeVerifications--; }
    },
    async assertPresent(images: VerifiedImage[], ownerId: string) {
      await Promise.all(images.map(async (image) => {
        ownedType(image.key, ownerId);
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: image.key, IfMatch: image.etag }), { abortSignal: AbortSignal.timeout(5000) });
        if (head.ETag !== image.etag || head.ContentLength !== image.length || head.ContentType !== image.type) throw new ProductMediaError("An uploaded image changed. Upload it again.");
      }));
      return images.map((image) => image.url);
    },
  };
}

let cachedStore: ReturnType<typeof createProductMediaStore> | undefined;
export function productMediaStore() {
  if (cachedStore) return cachedStore;
  const config = readStorageConfig();
  const client = new S3Client({ region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY } });
  cachedStore = createProductMediaStore(client, config.R2_BUCKET_NAME, config.R2_PUBLIC_URL);
  return cachedStore;
}

export async function generatePresignedUploadUrl(input: { ownerId: string; contentType: ProductImageType; size: number }) {
  return productMediaStore().prepare(input);
}
