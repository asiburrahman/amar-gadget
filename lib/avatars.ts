import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { accountAvatar, avatarKeyOwner, AVATAR_DETACH_RETENTION_MS } from "@/lib/avatar-policy";
import { AvatarError, decodeAvatarDataUrl, normalizeAvatarImage, type NormalizedAvatar } from "@/lib/avatar-image";
import { avatarMediaStore, newAvatarKey, type createAvatarMediaStore } from "@/lib/cloudflare/avatar-store";
export type AvatarSnapshot = { ownerId: string; avatar: string | null; avatarVersion: number; legacyAvatarAvailable: boolean };
export const avatarUserSelect = { id: true, avatar: true, avatarKey: true, avatarVersion: true } as const;
type AvatarUser = { id: string; avatar: string | null; avatarKey: string | null; avatarVersion: number };
type AvatarStore = ReturnType<typeof createAvatarMediaStore>;
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout='3000ms'`; return work(tx); }, { timeout: 10_000, maxWait: 5000 });
}
export async function lockAvatarActor(tx: Prisma.TransactionClient, actor: AuthenticatedUser, expectedVersion?: number) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { ...avatarUserSelect, role: true, isVerified: true, sessionVersion: true } });
  if (!current?.isVerified || current.role !== actor.role || current.sessionVersion !== actor.sessionVersion) throw new AvatarError("Your account changed. Reload your session before changing photos.", "AVATAR_ACCOUNT_CHANGED", 409);
  if (expectedVersion !== undefined && current.avatarVersion !== expectedVersion) throw new AvatarError("Your photo changed in another session. Reload the saved photo before retrying.", "AVATAR_CHANGED", 409);
  return current;
}
export async function avatarSnapshot(tx: Prisma.TransactionClient, user: AvatarUser): Promise<AvatarSnapshot> {
  return { ownerId: user.id, avatar: accountAvatar(user), avatarVersion: user.avatarVersion, legacyAvatarAvailable: !!await tx.userAvatarLegacy.findUnique({ where: { userId: user.id }, select: { userId: true } }) };
}
export async function enqueueDetachedAvatar(tx: Prisma.TransactionClient, key: string, ownerId: string) {
  if (avatarKeyOwner(key) !== ownerId) throw new AvatarError("The previous photo needs operator review.", "AVATAR_REFERENCE", 503);
  await tx.avatarImageCleanup.upsert({ where: { key }, create: { key, ownerId, availableAt: new Date(Date.now() + AVATAR_DETACH_RETENTION_MS) }, update: { availableAt: new Date(Date.now() + AVATAR_DETACH_RETENTION_MS), attempts: 0, lastError: null } });
}
export async function readOwnedAvatar(actor: AuthenticatedUser) {
  return transaction(async (tx) => avatarSnapshot(tx, await lockAvatarActor(tx, actor)));
}
/** The caller holds an upload slot, and normalized bytes never come directly
 * from a claimed browser MIME or a saved public URL. A durable pending job is
 * created before PUT so provider success followed by SQL failure has cleanup. */
export async function publishOwnedAvatar(actor: AuthenticatedUser, expectedVersion: number, image: NormalizedAvatar, store: AvatarStore = avatarMediaStore()) {
  const key = newAvatarKey(actor.id);
  await transaction(async (tx) => { await lockAvatarActor(tx, actor, expectedVersion); await enqueueDetachedAvatar(tx, key, actor.id); });
  const uploaded = await store.put(key, actor.id, image);
  return transaction(async (tx) => {
    const current = await lockAvatarActor(tx, actor, expectedVersion);
    const url = await store.assertPresent(uploaded, actor.id);
    if (current.avatarKey && current.avatarKey !== key) await enqueueDetachedAvatar(tx, current.avatarKey, actor.id);
    const saved = await tx.user.update({ where: { id: actor.id }, data: { avatar: url, avatarKey: key, avatarVersion: { increment: 1 } }, select: avatarUserSelect });
    await tx.userAvatarLegacy.deleteMany({ where: { userId: actor.id } });
    await tx.avatarImageCleanup.deleteMany({ where: { key, ownerId: actor.id } });
    return avatarSnapshot(tx, saved);
  });
}
/** Profile PUT may retain its observed current managed reference or remove a
 * photo with a revision. It cannot publish a new URL or inline payload; those
 * must pass the upload endpoint's complete bounded decode/storage pipeline. */
export async function updateProfileAvatarReference(tx: Prisma.TransactionClient, current: AvatarUser, value: string | null, expectedVersion: number) {
  if (current.avatarVersion !== expectedVersion) throw new AvatarError("Your photo changed. Reload the saved photo before updating it.", "AVATAR_CHANGED", 409);
  if (value) {
    if (!accountAvatar(current) || value !== accountAvatar(current)) throw new AvatarError("Upload a photo through the verified image endpoint; another URL cannot be assigned here.", "AVATAR_REFERENCE");
    return avatarSnapshot(tx, current);
  }
  const legacy = await tx.userAvatarLegacy.findUnique({ where: { userId: current.id }, select: { userId: true } });
  if (!current.avatarKey && !current.avatar && !legacy) return avatarSnapshot(tx, current);
  if (current.avatarKey) await enqueueDetachedAvatar(tx, current.avatarKey, current.id);
  const saved = await tx.user.update({ where: { id: current.id }, data: { avatar: null, avatarKey: null, avatarVersion: { increment: 1 } }, select: avatarUserSelect });
  await tx.userAvatarLegacy.deleteMany({ where: { userId: current.id } });
  return avatarSnapshot(tx, saved);
}
export async function removeOwnedAvatar(actor: AuthenticatedUser, expectedVersion: number) {
  return transaction(async (tx) => updateProfileAvatarReference(tx, await lockAvatarActor(tx, actor, expectedVersion), null, expectedVersion));
}
export async function restoreLegacyAvatar(actor: AuthenticatedUser, expectedVersion: number, store: AvatarStore = avatarMediaStore()) {
  const previous = await transaction(async (tx) => {
    await lockAvatarActor(tx, actor, expectedVersion);
    const legacy = await tx.userAvatarLegacy.findUnique({ where: { userId: actor.id }, select: { value: true } });
    if (!legacy) throw new AvatarError("No older photo is available to restore.", "AVATAR_LEGACY", 404);
    return legacy.value;
  });
  // Remote legacy URLs are never fetched. Only bounded stored raster data is
  // decoded; unsupported historical data remains private until replaced/removed.
  const source = decodeAvatarDataUrl(previous), image = await normalizeAvatarImage(source.bytes, source.type);
  return publishOwnedAvatar(actor, expectedVersion, image, store);
}
