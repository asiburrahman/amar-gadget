import { validateAvatarFile } from "@/lib/avatar-policy";
// One optional signup photo stays in RAM through client navigation. It is
// neither sent to anonymous registration nor persisted with credentials.
let pending: { email: string; file: File; expiresAt: number } | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const normalize = (email: string) => email.trim().toLowerCase();
export function clearRegistrationAvatar(email?: string) {
  if (email && pending?.email !== normalize(email)) return;
  clearTimeout(expiry); pending = null;
}
export function stageRegistrationAvatar(email: string, file: File | null) {
  clearRegistrationAvatar();
  if (!file) return;
  const invalid = validateAvatarFile(file); if (invalid) throw new Error(invalid);
  pending = { email: normalize(email), file, expiresAt: Date.now() + 15 * 60_000 };
  if (typeof window !== "undefined") expiry = setTimeout(() => clearRegistrationAvatar(), 15 * 60_000);
}
export function registrationAvatar(email: string) {
  if (pending && pending.expiresAt <= Date.now()) clearRegistrationAvatar();
  return pending?.email === normalize(email) ? pending.file : null;
}
