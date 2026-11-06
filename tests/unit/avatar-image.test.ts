import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { accountAvatar, avatarKeyFromUrl, validateAvatarFile, MAX_AVATAR_DATA_URL_LENGTH } from "@/lib/avatar-policy";
import { decodeAvatarDataUrl, normalizeAvatarImage, withAvatarUploadSlot } from "@/lib/avatar-image";
const owner = "owner", key = `avatars/${owner}/${randomUUID()}.webp`, url = `https://cdn.example.invalid/${key}`;
it("requires an owned managed key and safe public URL rather than trusting a historical inline or arbitrary avatar", () => {
  expect(accountAvatar({ id: owner, avatar: url, avatarKey: key, avatarVersion: 1 })).toBe(url);
  for (const avatar of ["data:image/png;base64,AAAA", "https://other.invalid/photo.png", `${url}?X-Amz-Signature=secret`, `${url}#fragment`, `https://user:secret@cdn.example.invalid/${key}`, `https://${"a".repeat(32)}.r2.cloudflarestorage.com/${key}`]) expect(accountAvatar({ id: owner, avatar, avatarKey: key, avatarVersion: 1 })).toBeNull();
  expect(accountAvatar({ id: "another-owner", avatar: url, avatarKey: key, avatarVersion: 1 })).toBeNull(); expect(accountAvatar({ id: owner, avatar: url, avatarKey: null, avatarVersion: 0 })).toBeNull();
  expect(avatarKeyFromUrl(url, owner)).toBe(key);
});
it("decodes and normalizes actual raster pixels to a bounded metadata-free WebP", async () => {
  const source = await sharp({ create: { width: 1000, height: 800, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const image = await normalizeAvatarImage(source, "image/jpeg"), metadata = await sharp(image.bytes).metadata();
  expect(metadata.format).toBe("webp"); expect(metadata.width).toBeLessThanOrEqual(512); expect(metadata.height).toBeLessThanOrEqual(512); expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
});
it("preserves raster transparency and checks actual signatures rather than the browser's claimed MIME", async () => {
  const png = await sharp({ create: { width: 30, height: 30, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png().toBuffer();
  expect((await sharp((await normalizeAvatarImage(png, "image/png")).bytes).metadata()).hasAlpha).toBe(true);
  await expect(normalizeAvatarImage(png, "image/jpeg")).rejects.toMatchObject({ code: "AVATAR_IMAGE" });
  await expect(normalizeAvatarImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png")).rejects.toMatchObject({ code: "AVATAR_IMAGE" });
  expect(validateAvatarFile({ type: "image/svg+xml", size: 10 })).toBeTruthy(); expect(validateAvatarFile({ type: "image/gif", size: 10 })).toBeTruthy();
});
it("rejects corrupt/truncated images, oversized sides and out-of-policy input sizes", async () => {
  await expect(normalizeAvatarImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png")).rejects.toMatchObject({ code: "AVATAR_IMAGE" });
  const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
  await expect(normalizeAvatarImage(wide, "image/png")).rejects.toMatchObject({ code: "AVATAR_IMAGE" });
  expect(validateAvatarFile({ type: "image/png", size: 0 })).toBeTruthy(); expect(validateAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toBeTruthy();
});
it("accepts only complete canonical raster data URLs and never fetches a legacy remote URL", async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "green" } }).png().toBuffer();
  expect(decodeAvatarDataUrl(`data:image/png;base64,${png.toString("base64")}`)).toEqual({ bytes: png, type: "image/png" });
  for (const value of ["https://other.invalid/portrait.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,a", "data:image/png;base64,AA", "data:image/png;base64,AAAA%20"]) expect(() => decodeAvatarDataUrl(value)).toThrow();
  expect(() => decodeAvatarDataUrl("x".repeat(MAX_AVATAR_DATA_URL_LENGTH + 1))).toThrow("exceeds");
});
it("bounds in-flight body/decode/storage work and releases a failed slot without retaining a waiting queue", async () => {
  let first!: () => void, second!: () => void;
  const a = withAvatarUploadSlot(() => new Promise<void>((resolve) => { first = resolve; })), b = withAvatarUploadSlot(() => new Promise<void>((resolve) => { second = resolve; }));
  await expect(withAvatarUploadSlot(async () => undefined)).rejects.toMatchObject({ code: "AVATAR_BUSY", status: 503 }); first(); second(); await Promise.all([a, b]);
  await expect(withAvatarUploadSlot(async () => { throw new Error("Controlled fixture failure"); })).rejects.toThrow("fixture");
  await expect(withAvatarUploadSlot(async () => "available")).resolves.toBe("available");
});
