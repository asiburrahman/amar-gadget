import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { Prisma } from "@prisma/client";
import { ProductGrid } from "@/components/shared/product-grid";
import { H1, P } from "@/components/ui/typography";
import { resolveCatalogBrand, type BrandFilterResult } from "@/lib/catalog-brand-filter";
import { withoutBrandFilter } from "@/lib/validations/catalog-brand";

type CatalogSearchParams = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<CatalogSearchParams>;
}): Promise<Metadata> {
  const resolved = searchParams ? await searchParams : {};
  try {
    const brand = await resolveCatalogBrand(resolved.brand, resolved.brandId);
    if (brand.state === "found") return { title: `${brand.brand.name} Collection | Amar Gadget`, description: `Browse available ${brand.brand.name} products in the marketplace.` };
    if (brand.state === "missing" || brand.state === "invalid") return { title: "Brand not found | Amar Gadget", robots: { index: false, follow: true } };
  } catch { return { title: "Products unavailable | Amar Gadget", robots: { index: false, follow: true } }; }
  const category = single(resolved.category);
  if (category) {
    const formatted = category
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return {
      title: `${formatted} Products | Amar Gadget`,
      description: `Browse authentic ${formatted} products with official warranty in Bangladesh.`,
    };
  }

  return {
    title: "All Products | Amar Gadget",
    description:
      "Browse flagship smartphones, laptops, audio, smart watches, and electronics in Bangladesh.",
  };
}

interface ProductItem {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  price: number;
  discountPrice?: number | null;
  stock: number;
  imageUrl?: string;
  category?: string;
  rating?: number;
}

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<CatalogSearchParams>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const categoryParam = single(resolvedParams.category)?.toLowerCase() || single(resolvedParams.categoryId);
  const searchParam = single(resolvedParams.search)?.trim();
  const filterParam = single(resolvedParams.filter);
  let brandFilter: BrandFilterResult = { state: "none" };
  let unavailable = false;

  let activeCategory: { id: string; name: string; slug: string } | null = null;
  let productData: ProductItem[] = [];

  try {
    brandFilter = await resolveCatalogBrand(resolvedParams.brand, resolvedParams.brandId);
    // If a category param is passed, find the corresponding category record
    if (categoryParam) {
      activeCategory = await prisma.category.findFirst({
        where: {
          OR: [
            { slug: { equals: categoryParam, mode: "insensitive" } },
            { id: { equals: categoryParam } },
            { name: { contains: categoryParam.replace(/-/g, " "), mode: "insensitive" } },
            ...(categoryParam === "wearables" ? [{ slug: "smart-watches" }] : []),
            ...(categoryParam === "computers" ? [{ slug: "laptops" }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });
    }

    const whereClause: Prisma.ProductWhereInput = {
      ...publicProductWhere,
    };
    const filters: Prisma.ProductWhereInput[] = [];
    if (brandFilter.state === "found") whereClause.brandId = brandFilter.brand.id;

    if (activeCategory) {
      whereClause.categoryId = activeCategory.id;
    } else if (categoryParam) {
      filters.push({ OR: [
        { category: { slug: { equals: categoryParam, mode: "insensitive" } } },
        { category: { name: { contains: categoryParam.replace(/-/g, " "), mode: "insensitive" } } },
      ] });
    }

    if (searchParam) {
      filters.push({
        OR: [
          { name: { contains: searchParam, mode: "insensitive" } },
          { description: { contains: searchParam, mode: "insensitive" } },
          { category: { name: { contains: searchParam, mode: "insensitive" } } },
        ],
      });
    }
    if (filters.length) whereClause.AND = filters;

    if (filterParam === "sale") {
      whereClause.discountPrice = { not: null, gt: 0 };
    }

    const products = brandFilter.state === "missing" || brandFilter.state === "invalid" ? [] : await prisma.product.findMany({
      where: whereClause,
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    productData = products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description ?? undefined,
      price: Number(product.price),
      discountPrice: product.discountPrice ? Number(product.discountPrice) : null,
      stock: product.stock,
      imageUrl: product.imageUrl ?? undefined,
      category: product.category?.name ?? undefined,
      rating: product.rating ?? 5,
    }));
  } catch {
    unavailable = true;
    console.error("Product collection is temporarily unavailable.");
  }
  const activeBrand = brandFilter.state === "found" ? brandFilter.brand : null;

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header Banner */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-10 lg:py-14">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3 border border-primary/20">
            {activeBrand ? `Brand: ${activeBrand.name}` : activeCategory ? `Category: ${activeCategory.name}` : "Official Warranty & Fast Delivery"}
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            {activeBrand ? `${activeBrand.name} Collection` : activeCategory ? `${activeCategory.name} Collection` : "Explore Tech Products"}
          </H1>
          <P className="mt-3 text-muted-foreground text-base max-w-xl mx-auto">
            {activeBrand ? `Browse ${activeBrand.name} products${activeCategory ? ` in ${activeCategory.name}` : ""}.`
              : activeCategory
              ? `Browse authentic ${activeCategory.name} products with genuine manufacturer warranty and express shipping.`
              : "Discover Bangladesh's widest collection of authentic smartphones, laptops, audio gear, and accessories."}
          </P>
          {(activeBrand || brandFilter.state === "missing" || brandFilter.state === "invalid") && <div className="mt-4"><Link href={withoutBrandFilter(resolvedParams)} className="text-sm font-semibold text-primary underline">Clear brand filter</Link></div>}

          {/* Quick Category link if filtered */}
          {activeCategory && (
            <div className="mt-5 flex items-center justify-center gap-3 text-xs">
              <Link
                href={`/categories/${activeCategory.slug}`}
                className="font-bold text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20"
              >
                Go to {activeCategory.name} Category Page &rarr;
              </Link>
              <Link
                href="/products"
                className="text-muted-foreground hover:text-foreground font-semibold bg-muted px-3 py-1.5 rounded-lg border"
              >
                ✕ Clear Filter (Show All)
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Main Grid Section */}
      <section className="container mx-auto px-4 py-10 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 pb-4 border-b gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {activeBrand ? `${activeBrand.name} Items` : activeCategory ? `${activeCategory.name} Items` : "All Gadgets"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Showing {productData.length} {productData.length === 1 ? "product" : "products"}
              {activeBrand ? ` from ${activeBrand.name}` : ""}{activeCategory ? ` in ${activeCategory.name}` : " across all categories"}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link
              href="/categories"
              className="text-primary hover:underline bg-primary/5 px-3 py-1.5 rounded-lg border border-primary/20"
            >
              Browse Categories Page &rarr;
            </Link>
          </div>
        </div>

        {unavailable ? <div role="alert" className="p-8 border rounded-xl"><h3 className="font-bold">Products are temporarily unavailable</h3><p>Please try this collection again shortly.</p></div>
          : brandFilter.state === "missing" ? <div role="status" className="p-8 border rounded-xl"><h3 className="font-bold">Brand not found</h3><p>No products are shown for this brand. Clear the brand filter or choose a brand from the directory.</p><Link href="/brands" className="text-primary underline">Browse brands</Link></div>
          : brandFilter.state === "invalid" ? <div role="alert" className="p-8 border rounded-xl"><h3 className="font-bold">Invalid brand filter</h3><p>{brandFilter.message}</p></div>
          : <ProductGrid products={productData} />}
      </section>
    </div>
  );
}
