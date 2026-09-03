"use client";

import React from "react";
import Link from "next/link";

export const BannerAd: React.FC = () => {
  return (
    <section className="py-6 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-gray-100 via-gray-50 to-gray-200 border border-gray-200 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between shadow-xs relative overflow-hidden">
          
          <div className="space-y-3 max-w-xl z-10 text-center md:text-left">
            <div className="inline-block bg-[#fed700] text-[#333e48] font-extrabold text-xs px-3 py-1 rounded-full uppercase tracking-wider">
              LIMITED TIME OFFER
            </div>
            <h2 className="text-2xl md:text-4xl font-extrabold text-[#333e48] uppercase tracking-tight leading-tight">
              SHOP AND <span className="text-[#333e48]">SAVE BIG</span> ON HOTTEST TABLETS
            </h2>
            <p className="text-sm text-gray-500 font-medium">
              Starting from only <span className="font-extrabold text-xl text-[#333e48]">$79.99</span> with official 1-year brand warranty.
            </p>
            
            <div className="pt-2">
              <Link
                href="/categories/tablets"
                className="inline-flex items-center justify-center bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-extrabold text-sm px-8 py-3 rounded-full shadow-md transition-all hover:scale-105"
              >
                Shop Now
              </Link>
            </div>
          </div>

          <div className="mt-6 md:mt-0 w-full max-w-xs h-44 relative flex items-center justify-center">
            <img
              src="https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500&auto=format&fit=crop&q=80"
              alt="Hottest Tablets Promo"
              className="max-h-full max-w-full object-contain drop-shadow-xl hover:scale-105 transition-transform"
            />
          </div>

        </div>
      </div>
    </section>
  );
};
