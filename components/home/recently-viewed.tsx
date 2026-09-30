"use client";

import React from "react";
import { ProductCard } from "@/components/shared/product-card";

export interface RecentlyViewedProductItem {
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

interface RecentlyViewedProps {
  products?: RecentlyViewedProductItem[];
}

export const RecentlyViewed: React.FC<RecentlyViewedProps> = ({ products = [] }) => {
  const displayProducts = products.slice(0, 8);

  if (displayProducts.length === 0) return null;

  return (
    <section className="py-12 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Recently Viewed
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Products you & other shoppers recently explored
          </p>
        </div>

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
      </div>
    </section>
  );
};
