"use client";

import React from "react";
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
  const displayProducts = products.slice(0, 8);

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
        {displayProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {displayProducts.map((item) => (
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
        ) : (
          <div className="text-center py-10 text-slate-400 text-sm">
            No products available yet.
          </div>
        )}

      </div>
    </section>
  );
};
