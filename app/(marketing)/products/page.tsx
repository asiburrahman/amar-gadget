import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ProductGrid } from "@/components/shared/product-grid";
import { H1, P } from "@/components/ui/typography";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "All Products | Amar Gadget",
    description: "Browse flagship smartphones, laptops, audio, smart watches, and electronics in Bangladesh.",
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

export default async function ProductsPage() {
  let productData: ProductItem[] = [];

  try {
    const products = await prisma.product.findMany({
      where: {
        status: "APPROVED",
        seller: {
          sellerStatus: "APPROVED",
        },
      },
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
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            Official Warranty & Fast Delivery
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Explore Tech Products
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Discover Bangladesh's widest collection of authentic smartphones, laptops, audio gear, and accessories.
          </P>
        </div>
      </section>

      {/* Main Grid Section */}
      <section className="container mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-8 pb-4 border-b">
          <div>
            <h2 className="text-xl font-bold text-foreground">All Gadgets</h2>
            <p className="text-xs text-muted-foreground">Showing {productData.length} items from database</p>
          </div>
        </div>

        <ProductGrid products={productData} />
      </section>
    </div>
  );
}