"use client";

import React from "react";
import Link from "next/link";

export const RecentlyViewed: React.FC = () => {
  const items = [
    {
      id: "rv-1",
      title: "Wireless Audio Speaker Bass 5.0",
      price: 685.00,
      imageUrl: "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=200&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-2",
      title: "Tablet Air 3 WiFi 64GB Silver Touch",
      price: 1215.00,
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=200&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-3",
      title: "Portable Over-Ear Wireless Headphones",
      price: 215.00,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-4",
      title: "Gear S3 Classic LTE Smartwatch Dual",
      price: 685.00,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=200&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-5",
      title: "Ultra HD 4K Action Camera Waterproof",
      price: 525.00,
      imageUrl: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=200&auto=format&fit=crop&q=80",
    },
    {
      id: "rv-6",
      title: "Multifunction Color Laser All-In-One Printer",
      price: 480.00,
      imageUrl: "https://images.unsplash.com/photo-1612815150566-985e79c31923?w=200&auto=format&fit=crop&q=80",
    },
  ];

  return (
    <section className="py-12 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <h2 className="text-2xl font-black text-slate-900 border-b border-slate-200 pb-4 tracking-tight">
          Recently Viewed
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5 sm:gap-6">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/products/${item.id}`}
              className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-blue-300 hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div className="w-full h-24 relative mb-3 flex items-center justify-center">
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                />
              </div>

              <div>
                <span className="text-xs font-bold text-slate-900 group-hover:text-blue-600 line-clamp-2 leading-snug block mb-1.5 transition-colors">
                  {item.title}
                </span>
                <span className="text-xs font-black text-slate-900">
                  ${item.price.toFixed(2)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};
