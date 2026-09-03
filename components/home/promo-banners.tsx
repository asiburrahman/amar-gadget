"use client";

import React from "react";
import Link from "next/link";

export const PromoBanners: React.FC = () => {
  const banners = [
    {
      title: "CATCH BIG DEALS ON CAMCORDERS",
      imageUrl: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=300&auto=format&fit=crop&q=80",
      href: "/categories/cameras",
    },
    {
      title: "CATCH BIG DEALS ON LAPTOPS",
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=300&auto=format&fit=crop&q=80",
      href: "/categories/laptops",
    },
    {
      title: "CATCH BIG DEALS ON DESKTOPS",
      imageUrl: "https://images.unsplash.com/photo-1587831990711-23ca6441447b?w=300&auto=format&fit=crop&q=80",
      href: "/categories/computers",
    },
    {
      title: "CATCH BIG DEALS ON CAMERAS",
      imageUrl: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=300&auto=format&fit=crop&q=80",
      href: "/categories/cameras",
    },
  ];

  return (
    <section className="py-10 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {banners.map((item, idx) => (
          <Link
            key={idx}
            href={item.href}
            className="bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6 flex items-center justify-between hover:shadow-md hover:border-blue-300 transition-all group"
          >
            <div className="space-y-3 max-w-[62%]">
              <h3 className="text-xs font-black text-slate-900 tracking-tight leading-tight uppercase group-hover:text-blue-600 transition-colors">
                {item.title}
              </h3>
              <span className="inline-flex items-center text-xs font-bold text-slate-500 group-hover:text-blue-600 transition-colors">
                Shop now <span className="ml-1 text-blue-600 text-sm group-hover:translate-x-1 transition-transform">&rarr;</span>
              </span>
            </div>

            <div className="w-20 h-20 relative flex items-center justify-center shrink-0">
              <img
                src={item.imageUrl}
                alt={item.title}
                className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};
