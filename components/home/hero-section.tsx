"use client";

import React from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/formatter";

interface HeroSectionProps {
  featuredProduct?: {
    id: string;
    slug?: string;
    name: string;
    price: number;
    discountPrice?: number | null;
    imageUrl?: string;
  } | null;
  categories?: Array<{ id: string; name: string; slug?: string }>;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  featuredProduct,
  categories = [],
}) => {
  const defaultCategories = [
    { name: "All Categories", href: "/categories", isBold: true, hasSub: false },
    { name: "Top Deals", href: "/deals", isBold: true, hasSub: false },
    { name: "Smartphones", href: "/categories/smartphones", isBold: false, hasSub: true },
    { name: "Laptops & Computers", href: "/categories/laptops", isBold: false, hasSub: true },
    { name: "Audio & Headphones", href: "/categories/audio", isBold: false, hasSub: true },
    { name: "Smart Watches", href: "/categories/smart-watches", isBold: false, hasSub: true },
    { name: "Accessories", href: "/categories/accessories", isBold: false, hasSub: true },
    { name: "Electronics", href: "/categories/electronics", isBold: false, hasSub: true },
  ];

  const categoryList =
    categories.length > 0
      ? [
          { name: "All Categories", href: "/categories", isBold: true, hasSub: false },
          { name: "Top Deals", href: "/deals", isBold: true, hasSub: false },
          ...categories.map((c) => ({
            name: c.name,
            href: c.slug ? `/categories/${c.slug}` : `/categories`,
            isBold: false,
            hasSub: false,
          })),
        ]
      : defaultCategories;

  const targetLink = featuredProduct
    ? `/products/${featuredProduct.slug || featuredProduct.id}`
    : "/products";

  return (
    <section className="bg-[#f5f5f5] pt-0 pb-0 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
        
        {/* Left Category Sidebar Navigation Bar */}
        <div className="hidden lg:flex flex-col justify-between bg-white rounded-b-xl border border-gray-200 border-t-0 shadow-xs overflow-hidden h-full">
          <ul className="divide-y divide-gray-100 text-[13px]">
            {categoryList.slice(0, 9).map((cat, idx) => (
              <li key={idx}>
                <Link
                  href={cat.href}
                  className={`flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 hover:text-black transition-colors ${
                    cat.isBold ? "font-extrabold text-[#333e48]" : "font-medium text-[#333e48]"
                  }`}
                >
                  <span>{cat.name}</span>
                  {cat.hasSub && (
                    <span className="text-gray-400 text-xs font-semibold select-none">&gt;</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Hero Banner Slider */}
        <div className="lg:col-span-3 bg-transparent p-8 sm:p-10 lg:p-12 flex flex-col md:flex-row items-center justify-between min-h-[460px] relative overflow-hidden">
          
          {/* Banner Text Content */}
          <div className="max-w-md z-10 space-y-4 text-center md:text-left">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light text-[#333e48] tracking-tight leading-tight uppercase">
              THE NEW<br />
              <span className="font-light">STANDARD</span>
            </h1>

            <p className="text-xs font-bold text-[#333e48] uppercase tracking-wider leading-relaxed">
              {featuredProduct?.name || "FLAGSHIP GADGETS & ELECTRONICS"}
            </p>

            <div className="pt-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 block mb-1">
                STARTING FROM
              </span>
              <div className="flex items-baseline justify-center md:justify-start space-x-1 mb-5">
                <span className="text-3xl lg:text-4xl font-black text-[#333e48] tracking-tight">
                  {featuredProduct
                    ? formatCurrency(featuredProduct.discountPrice || featuredProduct.price)
                    : "Best Deals in BD"}
                </span>
              </div>

              <Link
                href={targetLink}
                className="inline-flex items-center justify-center bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-bold text-sm px-9 py-3.5 rounded-full shadow-sm transition-all hover:scale-105"
              >
                Start Buying
              </Link>
            </div>

            {/* Slider Bar & Dots */}
            <div className="flex items-center justify-center md:justify-start space-x-2 pt-6">
              <span className="w-6 h-2 rounded-full bg-[#fed700] cursor-pointer shadow-xs"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 hover:bg-gray-400 cursor-pointer"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 hover:bg-gray-400 cursor-pointer"></span>
            </div>
          </div>

          {/* Banner Image */}
          <div className="mt-8 md:mt-0 relative w-full max-w-md h-72 md:h-96 flex justify-center items-center">
            <img
              src={
                featuredProduct?.imageUrl ||
                "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80"
              }
              alt={featuredProduct?.name || "Featured Product"}
              className="object-contain max-h-full drop-shadow-2xl hover:scale-105 transition-transform duration-500"
            />
          </div>
        </div>

      </div>
    </section>
  );
};
