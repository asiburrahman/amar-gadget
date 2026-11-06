import { avatarKeyFromUrl, validateAvatarFile } from "@/lib/avatar-policy";
export type ClientAvatar = { ownerId: string; avatar: string | null; avatarVersion: number; legacyAvatarAvailable: boolean };
export function checkedAvatar(value: unknown, ownerId: string): ClientAvatar {
  if (!value || typeof value !== "object") throw new Error("Unable to confirm the saved photo. Reload it before retrying.");
  const photo = value as ClientAvatar;
  if (photo.ownerId !== ownerId || !Number.isSafeInteger(photo.avatarVersion) || photo.avatarVersion < 0 || typeof photo.legacyAvatarAvailable !== "boolean" || (photo.avatar !== null && (typeof photo.avatar !== "string" || !avatarKeyFromUrl(photo.avatar, ownerId)))) throw new Error("Unable to confirm the saved photo. Reload it before retrying.");
  return { ownerId, avatar: photo.avatar, avatarVersion: photo.avatarVersion, legacyAvatarAvailable: photo.legacyAvatarAvailable };
}
export async function uploadAvatarFile(ownerId: string, avatarVersion: number, file: File, signal?: AbortSignal) {
  const invalid = validateAvatarFile(file); if (invalid) throw new Error(invalid);
  const form = new FormData(); form.set("file", file); form.set("avatarVersion", String(avatarVersion));
  const response = await fetch("/api/user/upload-avatar", { method: "POST", headers: { "X-Avatar-Owner": ownerId }, body: form, signal });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Photo was not confirmed. Reload the saved photo before retrying.");
  return checkedAvatar(data.photo, ownerId);
}
