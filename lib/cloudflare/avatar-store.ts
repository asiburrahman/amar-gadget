import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { readStorageConfig } from "@/config/runtime";
import { isPublicStorageOrigin } from "@/lib/product-media-policy";
import { avatarKeyOwner, AVATAR_DETACH_RETENTION_MS, MAX_AVATAR_BYTES } from "@/lib/avatar-policy";
import { AvatarError, type NormalizedAvatar } from "@/lib/avatar-image";
export type StoredAvatar = { key: string; url: string; etag: string; length: number };
export function newAvatarKey(ownerId: string) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(ownerId)) throw new AvatarError("This account needs operator review before uploading a photo.", "AVATAR_OWNER");
  return `avatars/${ownerId}/${randomUUID()}.webp`;
}
/** SDK injection is for isolated HTTP tests only. Production's constructor
 * always selects the configured R2 account, bucket and public origin. */
export function createAvatarMediaStore(client: S3Client, bucket: string, publicBase: string) {
  if (!isPublicStorageOrigin(publicBase)) throw new AvatarError("Configure a public HTTPS media origin.", "AVATAR_STORAGE", 503);
  const base = new URL(publicBase).origin;
  const owned = (key: string, ownerId?: string) => { const owner = avatarKeyOwner(key); if (!owner || (ownerId !== undefined && owner !== ownerId)) throw new AvatarError("Invalid owned photo reference.", "AVATAR_OWNER"); return owner; };
  const url = (key: string) => `${base}/${key}`;
  return {
    async put(key: string, ownerId: string, image: NormalizedAvatar): Promise<StoredAvatar> {
      owned(key, ownerId);
      if (!image.bytes.length || image.bytes.length > MAX_AVATAR_BYTES || image.width > 512 || image.height > 512) throw new AvatarError("Invalid normalized photo.", "AVATAR_IMAGE");
      const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: image.bytes, ContentLength: image.bytes.length, ContentType: "image/webp", IfNoneMatch: "*", CacheControl: "public, max-age=31536000, immutable" }), { abortSignal: AbortSignal.timeout(10_000) });
      if (!result.ETag) throw new AvatarError("Photo storage could not confirm its uploaded object.", "AVATAR_STORAGE", 503);
      return { key, url: url(key), etag: result.ETag, length: image.bytes.length };
    },
    async assertPresent(image: StoredAvatar, ownerId: string) {
      owned(image.key, ownerId);
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: image.key, IfMatch: image.etag }), { abortSignal: AbortSignal.timeout(5000) });
      if (result.ETag !== image.etag || result.ContentType !== "image/webp" || result.ContentLength !== image.length) throw new AvatarError("The uploaded photo changed or is incomplete. Reload before retrying.", "AVATAR_STORAGE", 503);
      return url(image.key);
    },
    async unusedCandidate(key: string) {
      const ownerId = owned(key), result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
      if (!result.LastModified || result.LastModified.getTime() > Date.now() - AVATAR_DETACH_RETENTION_MS) return null;
      return { ownerId, url: url(key) };
    },
    async removeUnused(key: string) {
      owned(key);
      if (!await this.unusedCandidate(key)) throw new AvatarError("Only old detached photos can be removed.", "AVATAR_RETENTION");
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
    },
    async list(cursor?: string) {
      const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "avatars/", MaxKeys: 100, ContinuationToken: cursor }), { abortSignal: AbortSignal.timeout(5000) });
      return { keys: (result.Contents ?? []).flatMap((entry) => entry.Key ? [entry.Key] : []), cursor: result.NextContinuationToken };
    },
  };
}
let cached: ReturnType<typeof createAvatarMediaStore> | undefined;
export function avatarMediaStore() {
  if (cached) return cached;
  const config = readStorageConfig();
  const client = new S3Client({ region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY } });
  cached = createAvatarMediaStore(client, config.R2_BUCKET_NAME, config.R2_PUBLIC_URL); return cached;
}
