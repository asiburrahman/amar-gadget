import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductGrid } from "@/components/shared/product-grid";
import { H1, P } from "@/components/ui/typography";
import {
  ElectroCategoryShowcase,
  ShowcaseCategory,
  ShowcaseProduct,
} from "@/components/categories/electro-category-showcase";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Product Categories | Amar Gadget",
    description:
      "Browse tech categories: Smartphones, Laptops, Audio, Smart Watches, Accessories, and Electronics organized with official warranty in Bangladesh.",
  };
}

const getCategoryMeta = (name: string, slug: string) => {
  const lower = `${name} ${slug}`.toLowerCase();
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("tablet")) {
    return {
      icon: "📱",
      tagline: "Flagship iPhones, Galaxy, Pixel & iPads with official warranty",
      gradient: "from-blue-500/10 via-indigo-500/5 to-transparent",
      accent: "text-blue-600 bg-blue-500/10 border-blue-500/20",
    };
  }
  if (lower.includes("laptop") || lower.includes("computer") || lower.includes("macbook")) {
    return {
      icon: "💻",
      tagline: "MacBook M3, ultrabooks, workstations & high-performance computing",
      gradient: "from-purple-500/10 via-pink-500/5 to-transparent",
      accent: "text-purple-600 bg-purple-500/10 border-purple-500/20",
    };
  }
  if (lower.includes("audio") || lower.includes("headphone") || lower.includes("earbud") || lower.includes("sound")) {
    return {
      icon: "🎧",
      tagline: "Active noise-canceling headphones, TWS earbuds & Hi-Fi speakers",
      gradient: "from-amber-500/10 via-orange-500/5 to-transparent",
      accent: "text-amber-600 bg-amber-500/10 border-amber-500/20",
    };
  }
  if (lower.includes("watch") || lower.includes("wearable") || lower.includes("band")) {
    return {
      icon: "⌚",
      tagline: "Apple Watch, Galaxy Watch, fitness trackers & health wearables",
      gradient: "from-emerald-500/10 via-teal-500/5 to-transparent",
      accent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
    };
  }
  if (lower.includes("gaming") || lower.includes("console")) {
    return {
      icon: "🎮",
      tagline: "PlayStation 5, Xbox Series X, gaming mechanical peripherals",
      gradient: "from-rose-500/10 via-red-500/5 to-transparent",
      accent: "text-rose-600 bg-rose-500/10 border-rose-500/20",
    };
  }
  if (lower.includes("camera") || lower.includes("drone")) {
    return {
      icon: "📷",
      tagline: "Mirrorless cameras, action cams, 4K drones & creator gear",
      gradient: "from-cyan-500/10 via-sky-500/5 to-transparent",
      accent: "text-cyan-600 bg-cyan-500/10 border-cyan-500/20",
    };
  }
  if (lower.includes("accessori") || lower.includes("keyboard") || lower.includes("mouse") || lower.includes("charger")) {
    return {
      icon: "🔌",
      tagline: "Mechanical keyboards, ergonomic mice, fast GaN chargers & cables",
      gradient: "from-orange-500/10 via-amber-500/5 to-transparent",
      accent: "text-orange-600 bg-orange-500/10 border-orange-500/20",
    };
  }
  return {
    icon: "⚡",
    tagline: "Genuine consumer tech and electronics with authorized warranty",
    gradient: "from-primary/10 via-primary/5 to-transparent",
    accent: "text-primary bg-primary/10 border-primary/20",
  };
};

export default async function CategoriesPage() {
  let categories: any[] = [];

  try {
    categories = await prisma.category.findMany({
      include: {
        products: {
          where: {
            status: "APPROVED",
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
        },
      },
      orderBy: {
        name: "asc",
      },
    });
  } catch (error) {
    console.error("Error fetching categories with products:", error);
  }

  // Build format for ElectroCategoryShowcase
  const allProducts: ShowcaseProduct[] = [];
  const showcaseCategories: ShowcaseCategory[] = categories.map((cat) => {
    const products: ShowcaseProduct[] = cat.products.map((p: any) => {
      const prod: ShowcaseProduct = {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        price: Number(p.price),
        discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
        stock: p.stock,
        imageUrl: p.imageUrl,
        images: p.images || [],
        category: p.category?.name ?? cat.name,
        categorySlug: cat.slug,
        rating: p.rating,
      };
      allProducts.push(prod);
      return prod;
    });

    return {
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      products,
    };
  });

  const totalApprovedProducts = allProducts.length;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      {/* 1. Header Banner */}
      <section className="bg-white border-b border-gray-200 py-8 lg:py-12">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 text-xs font-bold text-[#333e48] bg-[#fed700]/30 rounded-full mb-3 border border-[#fed700]">
            <span>⚡</span>
            <span>Category-Wise Tech Showcase</span>
          </div>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[#333e48]">
            Shop by Category
          </H1>
          <P className="mt-2.5 text-gray-500 text-xs sm:text-sm max-w-xl mx-auto leading-relaxed">
            Click on any category in the navigation bar below to view its specific devices, official warranty information, and deals.
          </P>

          {/* Quick Metrics Bar */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-xs font-semibold text-gray-600">
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-2xs">
              <span className="text-emerald-600 font-bold">✓</span>
              <span>{categories.length} Categories</span>
            </span>
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-2xs">
              <span className="text-amber-500 font-bold">📦</span>
              <span>{totalApprovedProducts} In-Stock Gadgets</span>
            </span>
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-2xs">
              <span className="text-blue-500 font-bold">★</span>
              <span>100% Genuine with Warranty</span>
            </span>
          </div>
        </div>
      </section>

      {/* 2. THE ELECTRO TABBED CATEGORY SHOWCASE (Matches User Screenshot) */}
      <section className="container mx-auto px-4 py-8 max-w-7xl">
        <ElectroCategoryShowcase
          categories={showcaseCategories}
          allProducts={allProducts}
        />
      </section>

      {/* 3. Category Quick Cards Row */}
      <section className="container mx-auto px-4 pt-2 pb-8 max-w-7xl">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
          <h2 className="text-base font-extrabold text-[#333e48]">
            Explore All Category Collections
          </h2>
          <span className="text-xs text-gray-400 font-medium">
            Select a category to view full dedicated catalog
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {categories.map((cat) => {
            const meta = getCategoryMeta(cat.name, cat.slug);
            return (
              <Link
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className="group relative rounded-xl border border-gray-200 bg-white p-4 hover:border-[#fed700] hover:shadow-md transition-all duration-300 flex flex-col items-center text-center justify-between overflow-hidden"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} opacity-30 group-hover:opacity-100 transition-opacity`} />
                <div className="relative z-10 w-full space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-slate-50 border border-gray-100 flex items-center justify-center text-2xl shadow-2xs group-hover:scale-110 transition-transform">
                    {meta.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-xs sm:text-sm text-[#333e48] group-hover:text-[#0066cc] transition-colors line-clamp-1">
                      {cat.name}
                    </h3>
                    <span className="text-[11px] text-gray-400 font-medium">
                      {cat.products.length} {cat.products.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                </div>
                <div className="relative z-10 mt-3 pt-2 border-t border-gray-100 w-full flex items-center justify-center text-[11px] font-bold text-[#0066cc] group-hover:translate-x-0.5 transition-transform">
                  <span>View Category &rarr;</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 4. Category-Wise Segregated Detailed Sections */}
      <main className="container mx-auto px-4 py-6 max-w-7xl space-y-12">
        {categories.map((cat) => {
          const meta = getCategoryMeta(cat.name, cat.slug);
          const formattedProducts = cat.products.map((p: any) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            description: p.description ?? undefined,
            price: Number(p.price),
            discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
            stock: p.stock,
            imageUrl: p.imageUrl ?? undefined,
            category: p.category?.name ?? cat.name,
            rating: p.rating ?? 5,
          }));

          return (
            <section
              key={cat.id}
              id={`category-${cat.slug}`}
              className="scroll-mt-28 rounded-2xl border border-gray-200 bg-white p-5 sm:p-7 shadow-xs relative overflow-hidden"
            >
              {/* Category Header Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 mb-6 border-b border-gray-100 gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-slate-50 border border-gray-200 shadow-2xs flex items-center justify-center text-2xl shrink-0">
                    {meta.icon}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/categories/${cat.slug}`}
                        className="text-xl sm:text-2xl font-black text-[#333e48] hover:text-[#0066cc] transition-colors tracking-tight flex items-center gap-1.5 group"
                      >
                        <span>{cat.name}</span>
                        <span className="text-sm text-[#0066cc] opacity-0 group-hover:opacity-100 transition-opacity">
                          ↗
                        </span>
                      </Link>
                      <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-[#fed700]/20 text-[#333e48] border border-[#fed700]/40">
                        {formattedProducts.length} {formattedProducts.length === 1 ? "Product" : "Products"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 max-w-xl">
                      {meta.tagline}
                    </p>
                  </div>
                </div>

                {/* View Category Detail Link - Strictly routes to /categories/[slug] */}
                <Link
                  href={`/categories/${cat.slug}`}
                  className="inline-flex items-center gap-2 text-xs font-bold text-[#333e48] bg-[#fed700] hover:bg-[#eec800] px-4 py-2.5 rounded-xl transition-all duration-200 self-start sm:self-auto shrink-0 shadow-2xs hover:scale-102"
                >
                  <span>View All {cat.name}</span>
                  <span className="font-extrabold">&rarr;</span>
                </Link>
              </div>

              {/* Category Products */}
              {formattedProducts.length > 0 ? (
                <ProductGrid products={formattedProducts} />
              ) : (
                <div className="text-center py-12 px-4 rounded-xl border border-dashed border-gray-200 bg-slate-50/50">
                  <span className="text-3xl block mb-2">{meta.icon}</span>
                  <p className="text-sm font-bold text-[#333e48]">
                    No products currently listed in {cat.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    New items in this category are being inspected by our team and will be available soon.
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}