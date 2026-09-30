import React from "react";
import { prisma } from "@/lib/prisma";
import { SEOGuard } from "@/components/shared/seo-guard";
import { HeroSection } from "@/components/home/hero-section";
import { PromoBanners } from "@/components/home/promo-banners";
import { SpecialDealSection, DynamicProductItem } from "@/components/home/special-deal-section";
import { BestSellersSection } from "@/components/home/best-sellers-section";
import { BannerAd } from "@/components/home/banner-ad";
import { RecentlyViewed } from "@/components/home/recently-viewed";
import { BrandLogos } from "@/components/home/brand-logos";
import { BottomWidgets } from "@/components/home/bottom-widgets";
import { NewsletterBar } from "@/components/home/newsletter-bar";
import { ElectroFooter } from "@/components/footer/electro-footer";

export const revalidate = 60; // Revalidate every minute

export default async function Home() {
  let approvedProducts: DynamicProductItem[] = [];
  let dbCategories: Array<{ id: string; name: string }> = [];

  try {
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: {
          status: "APPROVED",
          seller: {
            sellerStatus: "APPROVED",
          },
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.category.findMany({
        select: {
          id: true,
          name: true,
        },
        take: 10,
      }),
    ]);

    dbCategories = categories;

    approvedProducts = products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description ?? undefined,
      price: Number(p.price),
      discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
      stock: p.stock,
      imageUrl: p.imageUrl ?? undefined,
      category: p.category?.name ?? undefined,
      rating: p.rating ?? 5,
    }));
  } catch (error) {
    console.error("Error loading homepage dynamic products from database:", error);
  }

  // Derive filtered dynamic lists from approved database products
  const featuredProducts = approvedProducts.length > 0 ? approvedProducts : [];
  const onSaleProducts = approvedProducts.filter((p) => p.discountPrice && p.discountPrice < p.price);
  const topRatedProducts = [...approvedProducts].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  
  // Pick the best product for the special deal countdown card
  const specialProduct =
    onSaleProducts.length > 0
      ? onSaleProducts[0]
      : approvedProducts.length > 0
      ? approvedProducts[0]
      : null;

  return (
    <SEOGuard>
      <div className="flex-1 flex flex-col bg-white text-slate-900">
        <main className="flex-1">
          {/* 1. Hero Section with dynamic categories and featured product */}
          <HeroSection
            featuredProduct={specialProduct}
            categories={dbCategories}
          />

          {/* 2. Four Feature Promo Banners */}
          <PromoBanners />

          {/* 3. Special Offer Deal & Tabbed Products - 100% database driven */}
          <SpecialDealSection
            specialProduct={specialProduct}
            featuredProducts={featuredProducts}
            onSaleProducts={onSaleProducts}
            topRatedProducts={topRatedProducts}
          />

          {/* 4. Best Sellers Row - Dynamic Approved Products */}
          <BestSellersSection products={approvedProducts} />

          {/* 5. Wide Shop & Save Big Banner */}
          <BannerAd />

          {/* 6. Recently Viewed Products - Dynamic Approved Products */}
          <RecentlyViewed products={approvedProducts} />

          {/* 7. Brand / Partner Logos Bar */}
          <BrandLogos />

          {/* 8. 3-Column Bottom Product Widgets - Dynamic Approved Products */}
          <BottomWidgets
            featuredProducts={featuredProducts}
            onSaleProducts={onSaleProducts}
            topRatedProducts={topRatedProducts}
          />

          {/* 9. Electro Signature Yellow Newsletter Bar */}
          <NewsletterBar />
        </main>

        {/* 10. Electro Footer */}
        <ElectroFooter />
      </div>
    </SEOGuard>
  );
}