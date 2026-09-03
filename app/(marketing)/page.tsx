"use client";

import React from "react";
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

export default function Home() {
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

          {/* 4. Best Sellers Row */}
          <BestSellersSection />

          {/* 5. Wide Shop & Save Big Banner */}
          <BannerAd />

          {/* 6. Recently Viewed Products */}
          <RecentlyViewed />

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