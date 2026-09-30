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
  const formattedTitle = slug
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
          { name: { contains: decodedSlug, mode: "insensitive" } },
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
        { category: { name: { contains: decodedSlug, mode: "insensitive" } } },
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

  const productData = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? undefined,
    price: Number(p.price),
    discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
    stock: p.stock,
    imageUrl: p.imageUrl ?? undefined,
    category: p.category?.name ?? formattedTitle,
    rating: p.rating ?? 5,
  }));

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Category Header */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          {/* Breadcrumb */}
          <div className="flex items-center text-xs text-muted-foreground mb-4 space-x-2">
            <Link href="/" className="hover:text-primary">Home</Link>
            <span>/</span>
            <Link href="/categories" className="hover:text-primary">Categories</Link>
            <span>/</span>
            <span className="text-foreground font-semibold">{category?.name || formattedTitle}</span>
          </div>

          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            {category?.name || formattedTitle}
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-2xl">
            {category?.description || `Explore our authentic range of ${category?.name || formattedTitle} with official manufacturer warranty in Bangladesh.`}
          </P>
        </div>
      </section>

      {/* Main Grid */}
      <section className="container mx-auto px-4 py-10 max-w-6xl">
        <div className="flex items-center justify-between mb-8 pb-4 border-b">
          <div>
            <h2 className="text-xl font-bold text-foreground">Available Products</h2>
            <p className="text-xs text-muted-foreground">Showing {productData.length} items</p>
          </div>
          <Link
            href="/products"
            className="text-xs font-semibold text-primary hover:underline"
          >
            All Products &rarr;
          </Link>
        </div>

        <ProductGrid products={productData} />
      </section>
    </div>
  );
}
