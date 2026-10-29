import type { Prisma, PrismaClient } from "@prisma/client";
import type { createProductMediaStore } from "@/lib/cloudflare/r2";
import { imageKeyOwner, ownedImageKey } from "@/lib/product-image-keys";
export const IMAGE_DETACH_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function enqueueDetachedImages(tx: Prisma.TransactionClient, ownerId: string, previous: string[], current: string[]) {
  const keep = new Set(current.flatMap((url) => { const key = ownedImageKey(url, ownerId); return key ? [key] : []; }));
  const removed = [...new Set(previous.flatMap((url) => { const key = ownedImageKey(url, ownerId); return key && !keep.has(key) ? [key] : []; }))];
  for (const key of removed) await tx.productImageCleanup.upsert({ where: { key }, create: { key, ownerId, availableAt: new Date(Date.now() + IMAGE_DETACH_RETENTION_MS) }, update: { availableAt: new Date(Date.now() + IMAGE_DETACH_RETENTION_MS), attempts: 0, lastError: null } });
  return removed.length;
}
export async function imageKeyReferenced(tx: Prisma.TransactionClient, key: string) {
  if (!imageKeyOwner(key)) throw new Error("Invalid managed image key");
  const suffix = `%/${key}`;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE "imageUrl" LIKE ${suffix} OR EXISTS (SELECT 1 FROM unnest(images) AS image WHERE image LIKE ${suffix}) LIMIT 1`;
  return rows.length > 0;
}
export async function processImageCleanupJobs(db: PrismaClient, store: ReturnType<typeof createProductMediaStore>, { apply = false, limit = 5 }: { apply?: boolean; limit?: number } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Invalid cleanup batch size");
  const jobs = await db.productImageCleanup.findMany({ where: { availableAt: { lte: new Date() } }, orderBy: [{ availableAt: "asc" }, { key: "asc" }], take: limit, select: { key: true, ownerId: true } });
  const result = { inspected: jobs.length, removed: 0, retained: 0, missing: 0, deferred: 0, errors: 0, dryRun: !apply };
  for (const job of jobs) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
        // Lock order matches publication/replacement: owner, then job. Never
        // hold a job lock while waiting for an owner whose edit enqueues it.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${job.ownerId} FOR UPDATE`;
        await tx.$queryRaw`SELECT key FROM "ProductImageCleanup" WHERE key = ${job.key} FOR UPDATE`;
        const current = await tx.productImageCleanup.findUnique({ where: { key: job.key } });
        if (!current || current.availableAt.getTime() > Date.now()) return "deferred";
        if (imageKeyOwner(current.key) !== current.ownerId) throw new Error("Invalid cleanup ownership");
        if (await imageKeyReferenced(tx, current.key)) { if (apply) await tx.productImageCleanup.delete({ where: { key: current.key } }); return "retained"; }
        const candidate = await store.unusedCandidate(current.key);
        if (!candidate) { if (apply) await tx.productImageCleanup.update({ where: { key: current.key }, data: { availableAt: new Date(Date.now() + IMAGE_DETACH_RETENTION_MS) } }); return "deferred"; }
        if (apply) {
          await store.removeUnused(current.key);
          await tx.productImageCleanup.delete({ where: { key: current.key } });
        }
        return apply ? "removed" : "deferred";
      }, { timeout: 15_000, maxWait: 5000 });
      result[outcome]++;
    } catch (error) {
      // DELETE is idempotent; a provider success followed by SQL failure is
      // retried safely. Only an exact provider 404 clears an already-gone key.
      const missing = typeof error === "object" && error !== null && "$metadata" in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404;
      if (missing) {
        try { if (apply) await db.productImageCleanup.deleteMany({ where: { key: job.key, ownerId: job.ownerId, availableAt: { lte: new Date() } } }); result.missing++; continue; } catch { /* Retain the job for retry. */ }
      }
      result.errors++;
      if (apply) await db.productImageCleanup.updateMany({ where: { key: job.key, ownerId: job.ownerId, availableAt: { lte: new Date() } }, data: { attempts: { increment: 1 }, lastError: "Storage or cleanup transaction unavailable", availableAt: new Date(Date.now() + 5 * 60 * 1000) } }).catch(() => undefined);
    }
  }
  return result;
}
