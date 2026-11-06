import { z } from "zod";
export const MAX_COMPARISON_PRODUCTS = 4;
export const comparisonIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/);
export const comparisonIdsSchema = z.array(comparisonIdSchema).max(MAX_COMPARISON_PRODUCTS).refine((ids) => new Set(ids).size === ids.length, "Choose each product once.");
export function comparisonHref(ids: string[]) {
  const params = new URLSearchParams(); for (const id of comparisonIdsSchema.parse(ids)) params.append("product", id);
  return `/compare${params.size ? `?${params}` : ""}`;
}
export function comparisonQuery(input: Record<string, string | string[] | undefined>) {
  const value = input.product;
  return comparisonIdsSchema.safeParse(value === undefined ? [] : Array.isArray(value) ? value : [value]);
}
