import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
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

      {/* 2. ALL-IN-ONE ELECTRO TABBED CATEGORY SHOWCASE */}
      <section className="container mx-auto px-4 py-8 max-w-7xl">
        <ElectroCategoryShowcase
          categories={showcaseCategories}
          allProducts={allProducts}
        />
      </section>
    </div>
  );
}