import { publicTaxonomyQuerySchema } from "@/lib/validations/collection-query";
import { getCatalogOptions } from "@/lib/catalog-options";
export async function readTaxonomyOptions(kind: "category" | "brand", raw: unknown = {}) {
  const query = publicTaxonomyQuerySchema.parse(raw);
  const result = await getCatalogOptions(kind, query.q, query.page);
  return { ...result, q: query.q, items: result.items.map((item) => ({ ...item, name: item.baseName ?? item.name, pathLabel: item.name })) };
}
