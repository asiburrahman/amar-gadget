"use client";

import React from "react";
import Link from "next/link";
import { useCartStore } from "@/stores/cart-store";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { Star } from "@/components/icons/Star";

export const BestSellersSection: React.FC = () => {
  const addItem = useCartStore((state) => state.addItem);

  const bestSellers = [
    {
      id: "bs-1",
      category: "Tablets",
      title: "Tablet Slim Air 10.5 Inch WiFi 128GB",
      price: 520.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=300&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-2",
      category: "Laptops",
      title: "Notebook Pro 15 M2 Metal Body Ultra",
      price: 1200.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=300&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-3",
      category: "Accessories",
      title: "Ultra Speed USB 3.0 Flash Drive 128GB",
      price: 110.00,
      rating: 4,
      imageUrl: "https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=300&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-4",
      category: "Audio",
      title: "Active Noise Canceling Studio Wireless",
      price: 79.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-5",
      category: "Smartwatches",
      title: "SmartWatch Active 2 Heart Rate Monitor",
      price: 170.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&auto=format&fit=crop&q=80",
    },
    {
      id: "bs-6",
      category: "VR Headsets",
      title: "Virtual Reality Immersive 3D Goggles",
      price: 250.00,
      rating: 4,
      imageUrl: "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=300&auto=format&fit=crop&q=80",
    },
  ];

  return (
    <section className="py-8 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Section Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-3">
          <h2 className="text-xl font-extrabold text-[#333e48]">
            Best Sellers
          </h2>

          <Link
            href="/products?sort=bestsellers"
            className="text-xs font-bold text-gray-500 hover:text-black transition-colors"
          >
            View All &rarr;
          </Link>
        </div>

        {/* 6 Products Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {bestSellers.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col justify-between hover:shadow-md transition-all group"
            >
              <div>
                <span className="text-[10px] font-semibold text-gray-400 block mb-1">
                  {item.category}
                </span>

                <Link
                  href={`/products/${item.id}`}
                  className="text-xs font-bold text-[#333e48] hover:text-black line-clamp-2 leading-snug mb-2 block transition-colors"
                >
                  {item.title}
                </Link>

                {/* Rating */}
                <div className="flex items-center space-x-0.5 text-[#fed700] mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-3 h-3 ${i < item.rating ? "fill-[#fed700]" : "text-gray-300"}`} />
                  ))}
                </div>

                {/* Image */}
                <div className="w-full h-32 relative mb-3 flex items-center justify-center">
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform"
                  />
                </div>
              </div>

              {/* Price & Add button */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="text-xs font-extrabold text-[#333e48]">
                  ${item.price.toFixed(2)}
                </span>
                <button
                  onClick={() =>
                    addItem({
                      id: item.id,
                      name: item.title,
                      price: item.price,
                      quantity: 1,
                    })
                  }
                  className="w-7 h-7 rounded-full bg-[#fed700] hover:bg-[#eec800] text-[#333e48] flex items-center justify-center transition-transform hover:scale-110 cursor-pointer"
                  title="Add to cart"
                >
                  <ShoppingCart className="w-3.5 h-3.5 text-[#333e48]" />
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
