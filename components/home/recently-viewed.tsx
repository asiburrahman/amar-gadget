"use client";

import React from "react";
import { ProductCard } from "@/components/shared/product-card";

interface ProductItem {
  id: string;
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
  products?: ProductItem[];
}

export const RecentlyViewed: React.FC<RecentlyViewedProps> = ({ products = [] }) => {
  const defaultItems: ProductItem[] = [
    {
      id: "rv-1",
      category: "Audio",
      name: "Sony WH-1000XM5 Noise Canceling Headphones",
      price: 38500,
      discountPrice: 34900,
      stock: 15,
      rating: 4.9,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-2",
      category: "Laptops",
      name: 'Apple MacBook Air 15" M3 Chip 16GB / 512GB',
      price: 182000,
      discountPrice: 174900,
      stock: 8,
      rating: 4.8,
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-3",
      category: "Accessories",
      name: "Keychron K2 Pro Wireless Mechanical Keyboard",
      price: 12500,
      stock: 20,
      rating: 4.8,
      imageUrl: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-4",
      category: "Smart Watches",
      name: "Samsung Galaxy Watch 6 Classic 47mm LTE",
      price: 34990,
      discountPrice: 31900,
      stock: 10,
      rating: 4.7,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-5",
      category: "Smartphones",
      name: "Samsung Galaxy S24 Ultra 512GB Titanium",
      price: 155000,
      discountPrice: 147000,
      stock: 9,
      rating: 4.8,
      imageUrl: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-6",
      category: "Tablets",
      name: "Apple iPad Air 11-Inch M2 Chip 256GB WiFi",
      price: 88000,
      discountPrice: 82500,
      stock: 11,
      rating: 4.7,
      imageUrl: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
    },
  ];

  const displayProducts = products.length > 0 ? products.slice(0, 6) : defaultItems;

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

