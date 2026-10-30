import type { Prisma, PrismaClient } from "@prisma/client";
import type { createAvatarMediaStore } from "@/lib/cloudflare/avatar-store";
import { avatarKeyOwner, AVATAR_DETACH_RETENTION_MS } from "@/lib/avatar-policy";
type Store = ReturnType<typeof createAvatarMediaStore>;
export async function avatarKeyReferenced(tx: Prisma.TransactionClient, key: string) {
  if (!avatarKeyOwner(key)) throw new Error("Invalid managed avatar key");
  const suffix = `%/${key}`;
  // Retain a live reference across historical/current CDN origins, including
  // manually imported catalog references. Never infer garbage from host change.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE "avatarKey"=${key} OR avatar LIKE ${suffix}
    UNION ALL SELECT id FROM "Product" WHERE "imageUrl" LIKE ${suffix} OR EXISTS(SELECT 1 FROM unnest(images) AS image WHERE image LIKE ${suffix}) LIMIT 1`;
  return rows.length > 0;
}
export async function processAvatarCleanupJobs(db: PrismaClient, store: Store, { apply = false, limit = 2 }: { apply?: boolean; limit?: number } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Invalid avatar cleanup batch size");
  const jobs = await db.avatarImageCleanup.findMany({ where: { availableAt: { lte: new Date() } }, orderBy: [{ availableAt: "asc" }, { key: "asc" }], take: limit, select: { key: true, ownerId: true } });
  const result = { inspected: jobs.length, removed: 0, retained: 0, missing: 0, deferred: 0, errors: 0, dryRun: !apply };
  for (const job of jobs) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout='1500ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='4000ms'`;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${job.ownerId} FOR UPDATE`;
        await tx.$queryRaw`SELECT key FROM "AvatarImageCleanup" WHERE key=${job.key} FOR UPDATE`;
        const current = await tx.avatarImageCleanup.findUnique({ where: { key: job.key } });
        if (!current || current.availableAt.getTime() > Date.now()) return "deferred";
        if (avatarKeyOwner(current.key) !== current.ownerId) throw new Error("Invalid avatar cleanup ownership");
        if (await avatarKeyReferenced(tx, current.key)) { if (apply) await tx.avatarImageCleanup.delete({ where: { key: current.key } }); return "retained"; }
        if (!await store.unusedCandidate(current.key)) { if (apply) await tx.avatarImageCleanup.update({ where: { key: current.key }, data: { availableAt: new Date(Date.now() + AVATAR_DETACH_RETENTION_MS) } }); return "deferred"; }
        if (apply) { await store.removeUnused(current.key); await tx.avatarImageCleanup.delete({ where: { key: current.key } }); }
        return apply ? "removed" : "deferred";
      }, { timeout: 15_000, maxWait: 5000 }); result[outcome]++;
    } catch (error) {
      const missing = typeof error === "object" && error !== null && "$metadata" in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404;
      if (missing) {
        try { if (apply) await db.avatarImageCleanup.deleteMany({ where: { key: job.key, ownerId: job.ownerId, availableAt: { lte: new Date() } } }); result.missing++; continue; } catch { /* Keep the durable job for retry. */ }
      }
      result.errors++;
      if (apply) await db.avatarImageCleanup.updateMany({ where: { key: job.key, ownerId: job.ownerId, availableAt: { lte: new Date() } }, data: { attempts: { increment: 1 }, lastError: "Avatar storage or cleanup transaction unavailable", availableAt: new Date(Date.now() + 5 * 60_000) } }).catch(() => undefined);
    }
  }
  return result;
}
export async function cleanupAvatarOrphans(db: PrismaClient, store: Store, { apply = false, cursor }: { apply?: boolean; cursor?: string } = {}) {
  const page = await store.list(cursor), result = { inspected: page.keys.length, unused: 0, removed: 0, retained: 0, errors: 0, cursor: page.cursor };
  for (const key of page.keys) {
    try {
      const candidate = await store.unusedCandidate(key); if (!candidate) { result.retained++; continue; }
      const outcome = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.ownerId} FOR UPDATE`;
        const pending = await tx.avatarImageCleanup.findUnique({ where: { key }, select: { availableAt: true } });
        if (pending && pending.availableAt.getTime() > Date.now() || await avatarKeyReferenced(tx, key)) return "retained";
        if (apply) await store.removeUnused(key); return apply ? "removed" : "unused";
      }, { timeout: 10_000, maxWait: 5000 });
      if (outcome === "removed") { result.removed++; result.unused++; } else result[outcome]++;
    } catch { result.errors++; }
  }
  return result;
}
