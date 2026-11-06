import { isStorageApiHost } from "@/lib/product-media-policy";
export const AVATAR_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarImageType = typeof AVATAR_IMAGE_TYPES[number];
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_DATA_URL_LENGTH = Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 64;
export const AVATAR_DETACH_RETENTION_MS = 24 * 60 * 60 * 1000;
export const AVATAR_SIDE = 512;
export const avatarKeyOwner = (key: string) => /^avatars\/([A-Za-z0-9-]{1,64})\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.exec(key)?.[1] ?? null;
export function avatarKeyFromUrl(value: string, ownerId: string) {
  if (!value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || isStorageApiHost(url.hostname)) return null;
    const key = url.pathname.slice(1); return avatarKeyOwner(key) === ownerId ? key : null;
  } catch { return null; }
}
/** DB provenance is required. A historical URL resembling a managed path is
 * not enough to turn an unverified image into a published storage reference. */
export function accountAvatar(value: { id: string; avatar: string | null; avatarKey: string | null; avatarVersion: number }) {
  return value.avatarKey && value.avatar && avatarKeyFromUrl(value.avatar, value.id) === value.avatarKey ? value.avatar : null;
}
/** Never serialize the private storage key or historical source value. */
export function accountWithSafeAvatar<T extends { id: string; avatar: string | null; avatarKey: string | null; avatarVersion: number; legacyAvatar?: { userId: string } | null }>(value: T) {
  const { avatarKey: _key, legacyAvatar, ...fields } = value;
  void _key;
  return { ...fields, avatar: accountAvatar(value), legacyAvatarAvailable: Boolean(legacyAvatar) };
}
export function validateAvatarFile(file: { type: string; size: number }) {
  if (!AVATAR_IMAGE_TYPES.includes(file.type as AvatarImageType)) return "Choose a JPEG, PNG or WebP photo.";
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_AVATAR_BYTES) return "Choose a photo between 1 byte and 5 MiB.";
  return null;
}
