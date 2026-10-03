import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductGrid } from "@/components/shared/product-grid";
import { H1, P } from "@/components/ui/typography";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug).toLowerCase();
  const formattedTitle = decodedSlug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return {
    title: `${formattedTitle} | Amar Gadget`,
    description: `Shop the best ${formattedTitle} collection with official warranty and fast shipping across Bangladesh.`,
  };
}

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug).toLowerCase();
  const normalizedSlug = decodedSlug.replace(/-/g, " ");
  const formattedTitle = decodedSlug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  let category: any = null;
  let products: any[] = [];

  try {
    category = await prisma.category.findFirst({
      where: {
        OR: [
          { slug: { equals: decodedSlug, mode: "insensitive" } },
          { slug: { equals: decodedSlug.replace(/-/g, ""), mode: "insensitive" } },
          { name: { equals: decodedSlug, mode: "insensitive" } },
          { name: { contains: normalizedSlug, mode: "insensitive" } },
          ...(decodedSlug === "wearables"
            ? [{ slug: "smart-watches" }, { name: { contains: "Watch", mode: "insensitive" as const } }]
            : []),
          ...(decodedSlug === "computers"
            ? [{ slug: "laptops" }, { name: { contains: "Laptop", mode: "insensitive" as const } }]
            : []),
        ],
      },
    });

    const whereClause: any = {
      status: "APPROVED",
    };

    if (category) {
      whereClause.categoryId = category.id;
    } else {
      whereClause.OR = [
        { name: { contains: decodedSlug, mode: "insensitive" } },
        { name: { contains: normalizedSlug, mode: "insensitive" } },
        { category: { name: { contains: decodedSlug, mode: "insensitive" } } },
        { category: { name: { contains: normalizedSlug, mode: "insensitive" } } },
      ];
    }

    products = await prisma.product.findMany({
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
  } catch (error) {
    console.error("Error querying category products:", error);
  }

  const categoryDisplayName = category?.name || formattedTitle;

  const productData = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? undefined,
    price: Number(p.price),
    discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
    stock: p.stock,
    imageUrl: p.imageUrl ?? undefined,
    category: p.category?.name ?? categoryDisplayName,
    rating: p.rating ?? 5,
  }));

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Category Header */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-10 lg:py-14">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Breadcrumb Navigation */}
          <div className="flex items-center text-xs text-muted-foreground mb-4 space-x-2">
            <Link href="/" className="hover:text-primary transition-colors">
              Home
            </Link>
            <span>/</span>
            <Link href="/categories" className="hover:text-primary transition-colors font-semibold">
              Categories
            </Link>
            <span>/</span>
            <span className="text-foreground font-bold">{categoryDisplayName}</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-bold mb-2">
                <span>⚡</span>
                <span>Category Collection</span>
              </div>
              <H1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground">
                {categoryDisplayName}
              </H1>
              <P className="mt-2 text-muted-foreground text-sm sm:text-base max-w-2xl leading-relaxed">
                {category?.description ||
                  `Explore our authentic collection of ${categoryDisplayName} with official manufacturer warranty and fast delivery in Bangladesh.`}
              </P>
            </div>

            <Link
              href="/categories"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-foreground transition-all duration-200 self-start sm:self-auto shrink-0 shadow-2xs hover:scale-102"
            >
              <span>← All Categories</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Main Grid */}
      <section className="container mx-auto px-4 py-10 max-w-6xl">
        <div className="flex items-center justify-between mb-8 pb-4 border-b">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {categoryDisplayName} Products
            </h2>
            <p className="text-xs text-muted-foreground">
              Showing {productData.length} {productData.length === 1 ? "item" : "items"} in this category
            </p>
          </div>
          <Link
            href="/categories"
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <span>Browse Other Categories</span>
            <span>&rarr;</span>
          </Link>
        </div>

        <ProductGrid products={productData} />
      </section>
    </div>
  );
}
