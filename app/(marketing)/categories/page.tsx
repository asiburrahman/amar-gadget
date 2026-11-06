import { Metadata } from "next";
import Link from "next/link";
import { readCategoryShowcase } from "@/lib/category-showcase";
import { categoryShowcaseQuerySchema } from "@/lib/validations/collection-query";
import { H1, P } from "@/components/ui/typography";
import {
  ElectroCategoryShowcase,
  ShowcaseCategory,
  ShowcaseProduct,
} from "@/components/categories/electro-category-showcase";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ searchParams }: Props = {}): Promise<Metadata> {
  const query = searchParams ? await searchParams : {};
  return {
    alternates: { canonical: '/categories' },
    ...(Object.keys(query).length ? { robots: { index: false, follow: true } } : {}),
    title: "Product Categories | Amar Gadget",
    description:
      "Browse the marketplace's available product categories and their catalog listings.",
  };
}

export default async function CategoriesPage({ searchParams }: Props = {}) {
  const parsed = categoryShowcaseQuerySchema.safeParse(searchParams ? await searchParams : {});
  if (!parsed.success) return <main className="container mx-auto space-y-3 p-6"><h1>Product Categories</h1><p role="alert">Check the category search, selection and page numbers.</p><Link href="/categories">Reset category browsing</Link></main>;
  const { query, choices, listing, selected } = await readCategoryShowcase(parsed.data);
  const href = (changes: Partial<typeof query>) => { const next = { ...query, ...changes }; return "/categories?" + new URLSearchParams({ q: next.q, categoryPage: String(next.categoryPage), page: String(next.page), ...(next.categoryId ? { categoryId: next.categoryId } : {}) }); };
  const rows = selected && !choices.items.some((row) => row.id === selected.id) ? [selected, ...choices.items] : choices.items;
  const showcaseCategories: ShowcaseCategory[] = rows.map((row) => ({ id: row.id, name: row.baseName ?? row.name, pathLabel: row.name, slug: row.slug, image: row.image, parentId: row.parentId, products: [] }));
  const allProducts: ShowcaseProduct[] = listing.products.map((product) => ({ id: product.id, slug: product.slug, name: product.name, description: product.description, price: product.price, discountPrice: product.discountPrice, stock: product.stock, imageUrl: product.imageUrl, images: product.images, category: product.category.name, categorySlug: product.category.slug, rating: product.rating }));
  const totalApprovedProducts = listing.total;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      {/* 1. Header Banner & Breadcrumb */}
      <section className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 max-w-7xl pt-4 pb-1 text-xs text-gray-500 flex items-center gap-1.5">
          <Link href="/" className="hover:text-[#0066cc] transition-colors">
            Home
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-[#333e48] font-bold">Categories</span>
        </div>

        <div className="container mx-auto px-4 text-center max-w-3xl py-8 lg:py-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 text-xs font-bold text-[#333e48] bg-[#fed700]/30 rounded-full mb-3 border border-[#fed700]">
            <span>⚡</span>
            <span>Category-Wise Tech Showcase</span>
          </div>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[#333e48]">
            Shop by Category
          </H1>
          <P className="mt-2.5 text-gray-500 text-xs sm:text-sm max-w-xl mx-auto leading-relaxed">
            Choose a category below to browse its approved products and subcategories.
          </P>

          {/* Quick Metrics Bar */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-xs font-semibold text-gray-600">
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-2xs">
              <span className="text-emerald-600 font-bold">✓</span>
              <span>{choices.total} Matching Categories</span>
            </span>
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-2xs">
              <span className="text-amber-500 font-bold">📦</span>
              <span>{totalApprovedProducts} Approved Gadgets</span>
            </span>
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-2xs">
              <span className="text-blue-500 font-bold">★</span>
              <span>Current approved listings</span>
            </span>
          </div>
        </div>
      </section>

      {/* Server-paged category choices and products retain separate scopes. */}
      <section className="container mx-auto px-4 py-8 max-w-7xl">
        <form action="/categories" method="GET" className="mb-4 flex flex-wrap items-end gap-3">
          {query.categoryId && <input type="hidden" name="categoryId" value={query.categoryId} />}
          <label>Find a category or ancestor path<input name="q" type="search" maxLength={120} defaultValue={query.q} className="block rounded border p-2" /></label>
          <button type="submit" className="rounded border p-2">Search categories</button><Link href="/categories" className="underline">Reset browsing</Link>
        </form>
        <nav aria-label="Category choice pages" className="mb-5 flex flex-wrap items-center gap-4">
          <p>Category page {choices.page} of {Math.max(1, choices.totalPages)}; {choices.items.length} of {choices.total} matching choices shown.</p>
          {choices.page > 1 && <Link className="underline" href={href({ categoryPage: choices.page - 1 })}>Previous categories</Link>}
          {choices.page < choices.totalPages && <Link className="underline" href={href({ categoryPage: choices.page + 1 })}>Next categories</Link>}
          {choices.page > Math.max(1, choices.totalPages) && <Link className="underline" href={href({ categoryPage: 1 })}>Load the first category page</Link>}
        </nav>
        <p className="mb-4">Product scope: {selected ? selected.name + " and its subcategories" : query.categoryId ? "Selected category not found" : "All categories"}. Category search changes the choices shown; product pages follow the selected category.</p>
        {listing.categoryFilter.state === "missing" ? <p role="status">Category not found. <Link href="/categories" className="underline">Browse existing categories</Link></p> : listing.outOfRange ? <p role="status">This product page no longer exists. <Link className="underline" href={href({ page: 1 })}>Load the first product page</Link></p> : <ElectroCategoryShowcase
          key={`${query.categoryId ?? "all"}:${listing.page}`}
          categories={showcaseCategories}
          allProducts={allProducts}
          navigation={{ selectedId: query.categoryId ?? null, categoryPage: query.categoryPage, q: query.q, total: listing.total }}
        />}
        <nav aria-label="Category product pages" className="mt-5 flex flex-wrap items-center gap-4">
          <p>Product page {listing.page} of {Math.max(1, listing.totalPages)}; {listing.total} matching products.</p>
          {listing.page > 1 && <Link className="underline" href={href({ page: listing.page - 1 })}>Previous products</Link>}
          {listing.page < listing.totalPages && <Link className="underline" href={href({ page: listing.page + 1 })}>Next products</Link>}
        </nav>
      </section>
    </div>
  );
}
