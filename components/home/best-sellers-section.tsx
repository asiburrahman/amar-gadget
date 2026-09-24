"use client";

import React from "react";
import Link from "next/link";
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

interface BestSellersSectionProps {
  products?: ProductItem[];
}

export const BestSellersSection: React.FC<BestSellersSectionProps> = ({ products = [] }) => {
  // Fallback items if database products not yet loaded
  const defaultProducts: ProductItem[] = [
    {
      id: "bs-1",
      category: "Tablets",
      name: "Apple iPad Air 11-Inch M2 Chip 256GB WiFi",
      description: "Stunning Liquid Retina display with M2 power",
      price: 88000,
      discountPrice: 82500,
      stock: 12,
      rating: 4.8,
      imageUrl: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-2",
      category: "Laptops",
      name: 'Apple MacBook Air 15" M3 Chip 16GB / 512GB',
      description: "Liquid Retina display with 18-hour battery life",
      price: 182000,
      discountPrice: 174900,
      stock: 8,
      rating: 4.9,
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-3",
      category: "Accessories",
      name: "Logitech MX Master 3S Wireless Performance Mouse",
      description: "8K DPI track-on-glass optical sensor",
      price: 13900,
      discountPrice: 12500,
      stock: 14,
      rating: 4.9,
      imageUrl: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-4",
      category: "Audio",
      name: "Sony WH-1000XM5 Noise Canceling Headphones",
      description: "Industry-leading noise canceling headphones",
      price: 38500,
      discountPrice: 34900,
      stock: 15,
      rating: 4.9,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-5",
      category: "Smart Watches",
      name: "Samsung Galaxy Watch 6 Classic 47mm LTE",
      description: "Rotating stainless steel bezel with ECG sensor",
      price: 34990,
      discountPrice: 31900,
      stock: 10,
      rating: 4.7,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-6",
      category: "Smartphones",
      name: "Apple iPhone 16 Pro Max 256GB",
      description: "Natural Titanium finish with A18 Pro chip",
      price: 165000,
      discountPrice: 159990,
      stock: 6,
      rating: 4.9,
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
    },
  ];

  const displayProducts = products.length > 0 ? products.slice(0, 6) : defaultProducts;

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

        {/* Spacious Products Grid with Redesigned ProductCards */}
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

