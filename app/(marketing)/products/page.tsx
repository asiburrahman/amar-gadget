import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductGrid } from "@/components/shared/product-grid";
import { H1, P } from "@/components/ui/typography";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string; search?: string }>;
}): Promise<Metadata> {
  const resolved = searchParams ? await searchParams : {};
  if (resolved.category) {
    const formatted = resolved.category
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
  searchParams?: Promise<{
    category?: string;
    categoryId?: string;
    search?: string;
    filter?: string;
  }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const categoryParam = resolvedParams.category?.toLowerCase() || resolvedParams.categoryId;
  const searchParam = resolvedParams.search?.trim();
  const filterParam = resolvedParams.filter;

  let activeCategory: { id: string; name: string; slug: string } | null = null;
  let productData: ProductItem[] = [];

  try {
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

    const whereClause: any = {
      status: "APPROVED",
    };

    if (activeCategory) {
      whereClause.categoryId = activeCategory.id;
    } else if (categoryParam) {
      whereClause.OR = [
        { category: { slug: { equals: categoryParam, mode: "insensitive" } } },
        { category: { name: { contains: categoryParam.replace(/-/g, " "), mode: "insensitive" } } },
      ];
    }

    if (searchParam) {
      whereClause.AND = [
        {
          OR: [
            { name: { contains: searchParam, mode: "insensitive" } },
            { description: { contains: searchParam, mode: "insensitive" } },
            { category: { name: { contains: searchParam, mode: "insensitive" } } },
          ],
        },
      ];
    }

    if (filterParam === "sale") {
      whereClause.discountPrice = { not: null, gt: 0 };
    }

    const products = await prisma.product.findMany({
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
  } catch (error) {
    console.error("Database lookup on Products page error:", error);
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header Banner */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-10 lg:py-14">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3 border border-primary/20">
            {activeCategory ? `Category: ${activeCategory.name}` : "Official Warranty & Fast Delivery"}
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            {activeCategory ? `${activeCategory.name} Collection` : "Explore Tech Products"}
          </H1>
          <P className="mt-3 text-muted-foreground text-base max-w-xl mx-auto">
            {activeCategory
              ? `Browse authentic ${activeCategory.name} products with genuine manufacturer warranty and express shipping.`
              : "Discover Bangladesh's widest collection of authentic smartphones, laptops, audio gear, and accessories."}
          </P>

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
              {activeCategory ? `${activeCategory.name} Items` : "All Gadgets"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Showing {productData.length} {productData.length === 1 ? "product" : "products"}
              {activeCategory ? ` in ${activeCategory.name}` : " across all categories"}
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

        <ProductGrid products={productData} />
      </section>
    </div>
  );
}