import React from "react";
import { prisma } from "@/lib/prisma";
import { SEOGuard } from "@/components/shared/seo-guard";
import { HeroSection } from "@/components/home/hero-section";
import { PromoBanners } from "@/components/home/promo-banners";
import { SpecialDealSection } from "@/components/home/special-deal-section";
import { BestSellersSection } from "@/components/home/best-sellers-section";
import { BannerAd } from "@/components/home/banner-ad";
import { RecentlyViewed } from "@/components/home/recently-viewed";
import { BrandLogos } from "@/components/home/brand-logos";
import { BottomWidgets } from "@/components/home/bottom-widgets";
import { NewsletterBar } from "@/components/home/newsletter-bar";
import { ElectroFooter } from "@/components/footer/electro-footer";

export const revalidate = 60; // Revalidate every minute

export default async function Home() {
  let approvedProducts: Array<{
    id: string;
    name: string;
    description?: string;
    price: number;
    discountPrice?: number | null;
    stock: number;
    imageUrl?: string;
    category?: string;
    rating?: number;
  }> = [];

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

    approvedProducts = products.map((p) => ({
      id: p.id,
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
    console.error("Error loading homepage dynamic products:", error);
  }

  return (
    <SEOGuard>
      <div className="flex-1 flex flex-col bg-white text-slate-900">
        <main className="flex-1">
          {/* 1. Hero Section with Department Sidebar & Smartwatch Banner */}
          <HeroSection />

          {/* 2. Four Feature Promo Banners */}
          <PromoBanners />

          {/* 3. Special Offer Deal (Xbox Controller + Countdown) & Tabbed Products */}
          <SpecialDealSection />

          {/* 4. Best Sellers Row - Dynamic Approved Products */}
          <BestSellersSection products={approvedProducts} />

          {/* 5. Wide Shop & Save Big Banner */}
          <BannerAd />

          {/* 6. Recently Viewed Products - Dynamic Approved Products */}
          <RecentlyViewed products={approvedProducts} />

          {/* 7. Brand / Partner Logos Bar */}
          <BrandLogos />

          {/* 8. 3-Column Bottom Product Widgets & Side Banner */}
          <BottomWidgets />

          {/* 9. Electro Signature Yellow Newsletter Bar */}
          <NewsletterBar />
        </main>

        {/* 10. Electro Footer */}
        <ElectroFooter />
      </div>
    </SEOGuard>
  );
}