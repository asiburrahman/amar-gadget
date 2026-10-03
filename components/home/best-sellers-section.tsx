"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/shared/product-card";

export interface BestSellerProductItem {
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

interface BestSellersSectionProps {
  products?: BestSellerProductItem[];
}

export const BestSellersSection: React.FC<BestSellersSectionProps> = ({ products = [] }) => {
  const [showAll, setShowAll] = useState(false);
  const ROW_LIMIT = 4;
  const visibleProducts = showAll ? products : products.slice(0, ROW_LIMIT);

  return (
    <section className="py-10 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Section Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Best Sellers
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Top requested & approved flagship electronics in Bangladesh
            </p>
          </div>

          <Link
            href="/products?sort=bestsellers"
            className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline transition-all flex items-center gap-1"
          >
            View All &rarr;
          </Link>
        </div>

        {/* Spacious Products Grid with Dynamic Database Products */}
        {visibleProducts.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {visibleProducts.map((item) => (
                <ProductCard
                  key={item.id}
                  id={item.id}
                  slug={item.slug}
                  name={item.name}
                  description={item.description}
                  price={item.price}
                  discountPrice={item.discountPrice}
                  stock={item.stock}
                  imageUrl={item.imageUrl}
                  category={item.category}
                  rating={item.rating ?? 5}
                />
              ))}
            </div>

            {/* See More / See Less Button */}
            {products.length > ROW_LIMIT && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border border-gray-300 bg-white hover:bg-[#fed700] hover:border-[#fed700] text-[#333e48] font-bold text-xs sm:text-sm shadow-xs hover:shadow transition-all duration-200 cursor-pointer active:scale-95 group"
                >
                  <span>
                    {showAll
                      ? "See Less"
                      : `See More (${products.length - ROW_LIMIT} more)`}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-[#333e48] transition-transform duration-200 ${
                      showAll ? "rotate-180" : "group-hover:translate-y-0.5"
                    }`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-10 text-slate-400 text-sm">
            No products available yet.
          </div>
        )}

      </div>
    </section>
  );
};

