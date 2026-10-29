import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { readStorageConfig } from "@/config/runtime";
import { IMAGE_EXTENSIONS, MAX_PRODUCT_IMAGES, MAX_PRODUCT_IMAGE_BYTES, validateProductImage, type ProductImageType } from "@/lib/product-media-policy";

export class ProductMediaError extends Error {}

/** Dependency injection is for isolated SDK/HTTP tests; production always uses
 * the configured account's R2 endpoint, never a caller-selected host. */
export function createProductMediaStore(client: S3Client, bucket: string, publicBase: string) {
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
      return Promise.all(keys.map(async (key, index) => {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
        if (head.ContentType !== types[index] || !Number.isSafeInteger(head.ContentLength) || !head.ContentLength || head.ContentLength < 1 || head.ContentLength > MAX_PRODUCT_IMAGE_BYTES || !head.ETag) throw new ProductMediaError("An uploaded image has an invalid type or size. Upload it again.");
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-31", IfMatch: head.ETag }), { abortSignal: AbortSignal.timeout(5000) });
        if (object.ContentLength === undefined || object.ContentLength > 32 || !object.Body) { await object.Body?.transformToWebStream().cancel().catch(() => undefined); throw new ProductMediaError("Unable to validate the uploaded image."); }
        const bytes = Buffer.from(await object.Body.transformToByteArray());
        const valid = types[index] === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : types[index] === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
        if (!valid) throw new ProductMediaError("An uploaded file does not match its image format.");
        return publicUrl(key);
      }));
    },
  };
}

export function productMediaStore() {
  const config = readStorageConfig();
  const client = new S3Client({ region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY } });
  return createProductMediaStore(client, config.R2_BUCKET_NAME, config.R2_PUBLIC_URL);
}

export async function generatePresignedUploadUrl(input: { ownerId: string; contentType: ProductImageType; size: number }) {
  return productMediaStore().prepare(input);
}
