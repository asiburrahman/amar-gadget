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
  name: string;
  description?: string;
  price: number;
  stock: number;
  imageUrl?: string;
  category?: string;
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
      name: product.name,
      description: product.description ?? undefined,
      price: Number(product.price),
      stock: product.stock,
      imageUrl: product.imageUrl ?? undefined,
      category: product.category?.name ?? undefined,
    }));
  } catch (error) {
    console.error("Database lookup fallback on Products page:", error);
  }

  // Fallback featured products if database is empty
  if (productData.length === 0) {
    productData = [
      {
        id: "p-1",
        name: "Apple iPhone 16 Pro Max 256GB",
        description: "Natural Titanium finish with A18 Pro chip and telephoto camera.",
        price: 165000,
        stock: 12,
        imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
        category: "Smartphones",
      },
      {
        id: "p-2",
        name: 'Apple MacBook Air 15" M3 Chip 16GB / 512GB',
        description: "Liquid Retina display with 18-hour battery life and fanless design.",
        price: 182000,
        stock: 8,
        imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
        category: "Laptops",
      },
      {
        id: "p-3",
        name: "Sony WH-1000XM5 Noise Canceling Headphones",
        description: "Industry-leading noise canceling with dual processors and 30hr battery.",
        price: 38500,
        stock: 15,
        imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
        category: "Audio",
      },
      {
        id: "p-4",
        name: "Samsung Galaxy Watch 6 Classic 47mm LTE",
        description: "Rotating bezel with advanced sleep tracking and ECG sensor.",
        price: 34990,
        stock: 5,
        imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
        category: "Smart Watches",
      },
      {
        id: "p-5",
        name: "Keychron K2 Pro Wireless Mechanical Keyboard",
        description: "QMK/VIA programmable custom mechanical keyboard with RGB backlighting.",
        price: 12500,
        stock: 20,
        imageUrl: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=80",
        category: "Accessories",
      },
      {
        id: "p-6",
        name: "Logitech MX Master 3S Wireless Performance Mouse",
        description: "8K DPI track-on-glass sensor with Quiet Clicks and MagSpeed scrolling.",
        price: 13900,
        stock: 14,
        imageUrl: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&auto=format&fit=crop&q=80",
        category: "Accessories",
      },
    ];
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
            <p className="text-xs text-muted-foreground">Showing {productData.length} items</p>
          </div>
        </div>

        <ProductGrid products={productData} />
      </section>
    </div>
  );
}