import sharp from "sharp";
import { AVATAR_SIDE, MAX_AVATAR_BYTES, MAX_AVATAR_DATA_URL_LENGTH, validateAvatarFile, type AvatarImageType } from "@/lib/avatar-policy";
export class AvatarError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
let activeUploads = 0;
/** Acquire before reading a potentially large request body. No unbounded
 * decode/storage waiting queue is retained in an application process. */
export async function withAvatarUploadSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeUploads >= 2) throw new AvatarError("Photo uploads are busy. Retry shortly.", "AVATAR_BUSY", 503);
  activeUploads++;
  try { return await work(); } finally { activeUploads--; }
}
export function decodeAvatarDataUrl(value: string) {
  if (value.length > MAX_AVATAR_DATA_URL_LENGTH) throw new AvatarError("Photo data exceeds 5 MiB.", "AVATAR_SIZE", 413);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new AvatarError("Use a complete JPEG, PNG or WebP photo; remote URLs and other inline formats are not uploads.", "AVATAR_TYPE");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) throw new AvatarError("Photo encoding is incomplete or invalid.", "AVATAR_ENCODING");
  const error = validateAvatarFile({ type: match[1], size: bytes.length });
  if (error) throw new AvatarError(error, "AVATAR_SIZE", bytes.length > MAX_AVATAR_BYTES ? 413 : 400);
  return { bytes, type: match[1] as AvatarImageType };
}
function signature(bytes: Buffer, type: AvatarImageType) {
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
export type NormalizedAvatar = { bytes: Buffer; width: number; height: number };
export async function normalizeAvatarImage(bytes: Buffer, type: AvatarImageType): Promise<NormalizedAvatar> {
  const error = validateAvatarFile({ type, size: bytes.length });
  if (error || !signature(bytes, type)) throw new AvatarError(error ?? "Photo signature does not match its declared format.", "AVATAR_IMAGE");
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_000_000, limitInputChannels: 4, sequentialRead: true }).timeout({ seconds: 5 });
  try {
    const metadata = await image.metadata(), expected = type === "image/jpeg" ? "jpeg" : type === "image/png" ? "png" : "webp";
    if (metadata.format !== expected || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > 16_000_000 || (metadata.pages ?? 1) !== 1) throw new Error("Unsupported raster dimensions or frames");
    // Decode pixels, honor orientation and strip embedded metadata. Client
    // canvas output or claimed MIME alone can never bypass this transform.
    const output = await image.rotate().resize(AVATAR_SIDE, AVATAR_SIDE, { fit: "cover", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (output.info.format !== "webp" || !output.info.width || !output.info.height || output.info.width > AVATAR_SIDE || output.info.height > AVATAR_SIDE || output.data.length > MAX_AVATAR_BYTES) throw new Error("Invalid normalized raster");
    return { bytes: output.data, width: output.info.width, height: output.info.height };
  } catch { throw new AvatarError("Use a complete, single-frame JPEG, PNG or WebP photo up to 16 megapixels and 8192 pixels per side.", "AVATAR_IMAGE"); }
  finally { image.destroy(); }
}
