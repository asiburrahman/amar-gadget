import type { PrismaClient } from "@prisma/client";
import type { createProductMediaStore } from "@/lib/cloudflare/r2";

export async function cleanupProductImages(db: PrismaClient, store: ReturnType<typeof createProductMediaStore>, { apply = false, cursor }: { apply?: boolean; cursor?: string } = {}) {
  const page = await store.list(cursor);
  const result = { inspected: page.keys.length, unused: 0, removed: 0, retained: 0, errors: 0, cursor: page.cursor };
  for (const key of page.keys) {
    try {
      // No operation accepts arbitrary public URLs, prefixes or buckets.
      const candidate = await store.unusedCandidate(key);
      if (!candidate) { result.retained++; continue; }
      const outcome = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.ownerId} FOR UPDATE`;
        // Match the immutable key across old/new CDN domains. Changing the
        // public origin must never turn an existing image into garbage.
        const suffix = `%/${key}`;
        const referenced = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE "imageUrl" LIKE ${suffix} OR EXISTS (SELECT 1 FROM unnest(images) AS image WHERE image LIKE ${suffix}) LIMIT 1`;
        if (referenced.length) return "retained";
        if (apply) await store.removeUnused(key);
        return apply ? "removed" : "unused";
      }, { timeout: 10_000, maxWait: 5000 });
      if (outcome === "removed") { result.removed++; result.unused++; }
      else result[outcome]++;
    } catch { result.errors++; }
  }
  return result;
}
