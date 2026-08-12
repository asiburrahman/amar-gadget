import { Metadata } from "next";
import Link from "next/link";
import { H1, H2, P } from "@/components/ui/typography";
import { prisma } from "@/lib/prisma";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Product Categories | Amar Gadget",
    description: "Browse tech categories: Smartphones, Laptops, Audio & Headphones, Smart Watches, and Gaming Gear.",
  };
}

export default async function CategoriesPage() {
  const fallbackCategories = [
    {
      name: "Smartphones & Tablets",
      slug: "smartphones",
      description: "Flagship iPhones, Samsung Galaxy, Pixel, and OnePlus devices with warranty.",
      icon: "📱",
      count: "340+ Items",
      gradient: "from-blue-500/10 via-indigo-500/5 to-transparent",
    },
    {
      name: "Laptops & Computers",
      slug: "laptops",
      description: "MacBook M3, ultrabooks, gaming laptops, and high-performance desktops.",
      icon: "💻",
      count: "185+ Items",
      gradient: "from-purple-500/10 via-pink-500/5 to-transparent",
    },
    {
      name: "Audio & Headphones",
      slug: "audio",
      description: "Noise-canceling headphones, TWS earbuds, and premium Bluetooth speakers.",
      icon: "🎧",
      count: "210+ Items",
      gradient: "from-amber-500/10 via-orange-500/5 to-transparent",
    },
    {
      name: "Smart Watches & Wearables",
      slug: "wearables",
      description: "Apple Watch, Galaxy Watch, fitness trackers, and smart bands.",
      icon: "⌚",
      count: "145+ Items",
      gradient: "from-emerald-500/10 via-teal-500/5 to-transparent",
    },
    {
      name: "Gaming & Consoles",
      slug: "gaming",
      description: "PlayStation 5, Xbox Series X, mechanical keyboards, and gaming mice.",
      icon: "🎮",
      count: "95+ Items",
      gradient: "from-rose-500/10 via-red-500/5 to-transparent",
    },
    {
      name: "Cameras & Drones",
      slug: "cameras",
      description: "Sony mirrorless cameras, DJI action cams, gimbals, and aerial drones.",
      icon: "📷",
      count: "60+ Items",
      gradient: "from-cyan-500/10 via-sky-500/5 to-transparent",
    },
  ];

  let categories = [];
  try {
    const dbCategories = await prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: "asc" },
    });

    if (dbCategories.length > 0) {
      categories = dbCategories.map((c) => ({
        name: c.name,
        slug: c.slug,
        description: `Explore all products in ${c.name}`,
        icon: "⚡",
        count: `${c._count.products} Items`,
        gradient: "from-primary/10 via-primary/5 to-transparent",
      }));
    } else {
      categories = fallbackCategories;
    }
  } catch (error) {
    categories = fallbackCategories;
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            Organized Tech Collections
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Shop by Category
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Find exactly what you're looking for with curated categories across consumer electronics.
          </P>
        </div>
      </section>

      {/* Grid */}
      <section className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/products?category=${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${cat.gradient} opacity-50 group-hover:opacity-100 transition-opacity`} />
              
              <div className="relative z-10 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-4xl p-2 rounded-xl bg-background/80 shadow-sm border border-border/50 backdrop-blur-sm group-hover:scale-110 transition-transform duration-200">
                    {cat.icon}
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                    {cat.count}
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors">
                    {cat.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {cat.description}
                  </p>
                </div>
              </div>

              <div className="relative z-10 mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
                <span>Browse Category</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}