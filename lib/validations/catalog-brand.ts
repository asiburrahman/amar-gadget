import { z } from "zod";

const empty = (value: unknown) => typeof value === "string" && !value.trim() ? undefined : value;
export const brandQuerySchema = z.preprocess(empty, z.string().trim().min(1).max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).optional());
export const brandIdQuerySchema = z.preprocess(empty, z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).optional());
export const brandFilterSchema = z.object({ brand: brandQuerySchema, brandId: brandIdQuerySchema });

export function brandCollectionHref(brand: { slug: string; id: string }) {
  const parsed = brandQuerySchema.safeParse(brand.slug);
  return parsed.success && parsed.data && parsed.data === brand.slug
    ? `/products?brand=${encodeURIComponent(brand.slug)}`
    : `/products?brandId=${encodeURIComponent(brand.id)}`;
}

export function brandQueryValues(params: URLSearchParams) {
  const value = (key: string) => { const all = params.getAll(key); return all.length > 1 ? all : all[0]; };
  return { brand: value("brand"), brandId: value("brandId") };
}
export function withoutBrandFilter(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (["brand", "brandId", "page"].includes(key)) continue;
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  return `/products${query.size ? `?${query}` : ""}`;
}
