import { readApplicationOrigin } from "@/config/runtime";
import { brandQuerySchema } from "@/lib/validations/catalog-brand";
export function canonicalUrl(path = "/") {
  const origin = readApplicationOrigin();
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) throw new Error("Invalid canonical path.");
  const url = new URL(path, origin);
  if (url.origin !== origin || url.hash) throw new Error("Invalid canonical path.");
  return url.toString();
}
function catalogSegment(slug: string, id?: string) {
  const valid = Boolean(slug) && slug.length <= 512 && ![".", ".."].includes(slug) && !/[\u0000-\u001f\u007f]/.test(slug) && encodeURIComponent(slug).length <= 1600;
  const value = valid ? slug : id;
  if (!value) throw new Error("Catalog URL requires a usable slug or ID.");
  return encodeURIComponent(value);
}
export function productPath(slug: string, id?: string) { return `/products/${catalogSegment(slug, id)}`; }
export function categorySelector(category: { slug: string; id: string }) {
  const parsed = brandQuerySchema.safeParse(category.slug);
  return parsed.success && parsed.data === category.slug && Boolean(parsed.data) ? { category: category.slug, categoryId: undefined } : { category: undefined, categoryId: category.id };
}
export function categoryPath(category: { slug: string; id: string }) { return `/categories/${catalogSegment(categorySelector(category).category ?? "", category.id)}`; }
export function publicImageUrl(value?: string | null) {
  if (!value || /[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = value.startsWith("/") && !value.startsWith("//") ? new URL(value, readApplicationOrigin()) : new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.username || url.password || url.hash || (url.protocol !== "https:" && url.origin !== readApplicationOrigin())) return undefined;
    return url.toString();
  } catch { return undefined; }
}
