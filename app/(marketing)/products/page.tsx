import type { Metadata } from "next";
import Link from "next/link";
import { getCatalogListing, CatalogQueryError } from "@/lib/catalog-listing";
import { getCatalogOptions } from "@/lib/catalog-options";
import { catalogQuerySchema, catalogHref } from "@/lib/validations/catalog-query";
import { withoutBrandFilter } from "@/lib/validations/catalog-brand";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { ProductGrid } from "@/components/shared/product-grid";

type Params = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  try {
    const result = await getCatalogListing(searchParams ? await searchParams : {});
    if (result.brandFilter.state === "missing" || result.categoryFilter.state === "missing") return { title: "Collection not found | Amar Gadget", robots: { index: false, follow: true } };
    const brand = result.brandFilter.state === "found" ? result.brandFilter.brand : null;
    const category = result.categoryFilter.state === "found" ? result.categoryFilter.category : null;
    return { title: `${brand ? `${brand.name} Collection` : category ? `${category.name} Collection` : "All Products"} | Amar Gadget`, description: "Browse available marketplace products with price, category, brand and sorting controls." };
  } catch { return { title: "Products unavailable | Amar Gadget", robots: { index: false, follow: true } }; }
}
export default async function ProductsPage({ searchParams }: Params) {
  const input = searchParams ? await searchParams : {};
  let result: Awaited<ReturnType<typeof getCatalogListing>> | undefined;
  let error = "", code = "";
  try { result = await getCatalogListing(input); }
  catch (failure) { if (failure instanceof CatalogQueryError) { error = failure.message; code = failure.code; } else { error = "Products are temporarily unavailable. Please try again shortly."; console.error("Product collection is temporarily unavailable."); } }
  const brand = result?.brandFilter.state === "found" ? result.brandFilter.brand : undefined;
  const category = result?.categoryFilter.state === "found" ? result.categoryFilter.category : undefined;
  let options: { brands: Awaited<ReturnType<typeof getCatalogOptions>>; categories: Awaited<ReturnType<typeof getCatalogOptions>> } | undefined;
  try { const [brands, categories] = await Promise.all([getCatalogOptions("brand"), getCatalogOptions("category")]); options = { brands, categories }; }
  catch { console.error("Product filter options are temporarily unavailable."); }
  const query = result?.query ?? catalogQuerySchema.parse({});
  return <div className="min-h-screen bg-background pb-16">
    <section className="border-b py-10"><div className="container mx-auto px-4 max-w-7xl">
      <h1 className="text-3xl font-extrabold">{brand ? `${brand.name} Collection` : category ? `${category.name} Collection` : "Explore Tech Products"}</h1>
      <p className="mt-2 text-muted-foreground">{brand ? `Browse ${brand.name} products${category ? ` in ${category.name}` : ""}.` : "Find products by category, brand and current price."}</p>
      {(brand || result?.brandFilter.state === "missing" || code === "INVALID_BRAND") && <Link href={withoutBrandFilter(input)} className="inline-block mt-3 text-primary underline">Clear brand filter</Link>}
    </div></section>
    <main className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
      {options ? <CatalogFilters key={catalogHref(query)} query={query} brands={options.brands} categories={options.categories} brand={brand} category={category} /> : <p role="alert">Filter choices are temporarily unavailable. <Link href="/products" className="underline">Retry filters</Link></p>}
      {error ? <div role="alert" className="p-6 border rounded-xl"><h2>{code === "INVALID_BRAND" ? "Invalid brand filter" : code ? "Invalid product filters" : "Products are temporarily unavailable"}</h2><p>{error}</p><Link href="/products" className="underline">Reset filters</Link></div>
        : result && <>
          <p role="status">{result.total === 0 ? "Showing 0 of 0 products" : result.outOfRange ? `No products on page ${result.page}; ${result.total} products match.` : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(result.page * result.limit, result.total)} of ${result.total} products`}</p>
          {result.brandFilter.state === "missing" ? <div role="status"><h2>Brand not found</h2><p>No products are shown for this brand.</p><Link href="/brands">Browse brands</Link></div>
            : result.categoryFilter.state === "missing" ? <div role="status"><h2>Category not found</h2><p>No products are shown for this category.</p></div>
            : result.outOfRange ? <p><Link href={catalogHref(query, { page: 1 })} className="underline">Return to the first results page</Link></p>
            : <ProductGrid products={result.products.map((product) => ({ ...product, description: product.description ?? undefined, imageUrl: product.imageUrl ?? undefined, category: product.category.name }))} />}
          {result.totalPages > 1 && !result.outOfRange && <nav aria-label="Product result pages" className="flex flex-wrap gap-4 justify-center items-center">
            {result.page > 1 && <Link rel="prev" href={catalogHref(query, { page: result.page - 1 })}>Previous page</Link>}
            <span aria-current="page">Page {result.page} of {result.totalPages}</span>
            {result.page < result.totalPages && <Link rel="next" href={catalogHref(query, { page: result.page + 1 })}>Next page</Link>}
          </nav>}
        </>}
    </main>
  </div>;
}
