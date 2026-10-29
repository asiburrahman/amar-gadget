import { z } from "zod";
import { brandQuerySchema, brandIdQuerySchema } from "@/lib/validations/catalog-brand";
import { MAX_PRODUCT_PRICE, PRODUCT_STATUSES, CATALOG_PAGE_SIZE, CATALOG_MAX_PAGE_SIZE } from "@/lib/catalog-constants";

const empty = (value: unknown) => typeof value === "string" && !value.trim() ? undefined : value;
const number = (value: unknown) => { const clean = empty(value); return typeof clean === "string" && clean.length <= 20 && /^\d+(?:\.\d{1,2})?$/.test(clean) ? Number(clean) : clean; };
const integer = (value: unknown) => { const clean = empty(value); return typeof clean === "string" && /^\d{1,8}$/.test(clean) ? Number(clean) : clean; };
const price = z.preprocess(number, z.number().min(0).max(MAX_PRODUCT_PRICE).multipleOf(0.01).optional());
const search = z.preprocess(empty, z.string().trim().max(200).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).optional());
export const CATALOG_SORTS = ["latest", "price_low", "price_high", "rating", "bestsellers"] as const;
export const catalogQuerySchema = z.object({
  page: z.preprocess(integer, z.number().int().min(1).max(1_000_000).default(1)),
  limit: z.preprocess(integer, z.number().int().min(1).max(CATALOG_MAX_PAGE_SIZE).default(CATALOG_PAGE_SIZE)),
  search, q: search,
  category: brandQuerySchema, categoryId: brandIdQuerySchema,
  brand: brandQuerySchema, brandId: brandIdQuerySchema,
  minPrice: price, maxPrice: price,
  filter: z.preprocess(empty, z.literal("sale").optional()),
  sort: z.preprocess(empty, z.enum(CATALOG_SORTS).default("latest")),
  status: z.enum(PRODUCT_STATUSES).optional(),
}).refine((query) => query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice, { path: ["maxPrice"], message: "Maximum price must be at least the minimum price." })
  .refine((query) => !query.search || !query.q || query.search === query.q, { path: ["search"], message: "Search and q must select the same search text." })
  .transform(({ q, ...query }) => ({ ...query, search: query.search ?? q }));
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export function catalogQueryValues(params: URLSearchParams): Record<string, unknown> {
  return Object.fromEntries([...new Set(params.keys())].map((key) => { const values = params.getAll(key); return [key, values.length > 1 ? values : values[0]]; }));
}
export function catalogHref(query: CatalogQuery, changes: Partial<CatalogQuery> = {}) {
  const next = { ...query, ...changes }; const params = new URLSearchParams();
  for (const key of ["search", "category", "categoryId", "brand", "brandId", "minPrice", "maxPrice", "filter", "sort", "limit", "page"] as const) {
    const value = next[key];
    if (value === undefined || value === "" || (key === "sort" && value === "latest") || (key === "page" && value === 1) || (key === "limit" && value === CATALOG_PAGE_SIZE)) continue;
    params.set(key, String(value));
  }
  return `/products${params.size ? `?${params}` : ""}`;
}
