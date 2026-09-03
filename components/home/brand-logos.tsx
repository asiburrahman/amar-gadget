"use client";

import React from "react";

export const BrandLogos: React.FC = () => {
  const brands = [
    { name: "themeforest", fontStyle: "font-serif italic font-bold" },
    { name: "graphicriver", fontStyle: "font-mono font-bold" },
    { name: "photodune", fontStyle: "font-sans font-semibold tracking-wider" },
    { name: "audiojungle", fontStyle: "font-sans font-extrabold" },
    { name: "codecanyon", fontStyle: "font-mono tracking-tighter font-extrabold" },
  ];

  return (
    <section className="py-10 lg:py-12 bg-slate-50 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-around gap-8 sm:gap-12 opacity-60 hover:opacity-100 transition-opacity">
          {brands.map((brand, idx) => (
            <div key={idx} className="flex items-center space-x-1 cursor-pointer hover:scale-105 transition-transform">
              <span className={`text-xl md:text-2xl text-slate-500 hover:text-blue-600 transition-colors ${brand.fontStyle}`}>
                {brand.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
