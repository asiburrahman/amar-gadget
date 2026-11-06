import { categoryShowcaseQuerySchema } from "@/lib/validations/collection-query";
import { getCatalogOptions, getCategoryOption } from "@/lib/catalog-options";
import { getCatalogListing, CatalogQueryError } from "@/lib/catalog-listing";
import { serviceUnavailable } from "@/lib/observability";
export async function readCategoryShowcase(raw: unknown = {}) {
  const query = categoryShowcaseQuerySchema.parse(raw);
  try {
    const [choices, listing, selected] = await Promise.all([
      getCatalogOptions("category", query.q, query.categoryPage),
      getCatalogListing({ page: query.page, categoryId: query.categoryId, limit: 12 }),
      query.categoryId ? getCategoryOption(query.categoryId) : null,
    ]);
    return { query, choices, listing, selected };
  } catch (error) { if (error instanceof CatalogQueryError) throw error; throw serviceUnavailable("catalog.category-showcase", error); }
}
