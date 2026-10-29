import { z } from "zod";
export const MAX_RECENT_PRODUCTS = 20;
export const HISTORY_RETENTION_MS = 30 * 86400 * 1000;
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/);
export const recentIdsSchema = z.array(id).max(MAX_RECENT_PRODUCTS).refine((items) => new Set(items).size === items.length);
const entry = z.object({ id, viewedAt: z.number().int().positive() }).strict();
export type RecentEntry = z.infer<typeof entry>;
export function cleanHistory(input: unknown, now = Date.now()): RecentEntry[] {
  const parsed = z.array(entry).max(MAX_RECENT_PRODUCTS).safeParse(input);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  return parsed.data.filter((item) => item.viewedAt > now - HISTORY_RETENTION_MS && item.viewedAt <= now).sort((a, b) => b.viewedAt - a.viewedAt).filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}
