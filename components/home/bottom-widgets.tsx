"use client";

import React from "react";
import Link from "next/link";
import { Star } from "@/components/icons/Star";

export const BottomWidgets: React.FC = () => {
  const featuredList = [
    {
      id: "bw-1",
      title: "Purple Wireless Headphones Pro",
      price: 110.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=150&auto=format&fit=crop&q=80",
    },
    {
      id: "bw-2",
      title: "PowerBank Portable 20,000mAh",
      price: 49.00,
      rating: 4,
      imageUrl: "https://images.unsplash.com/photo-1609592424109-dd9892f1b177?w=150&auto=format&fit=crop&q=80",
    },
    {
      id: "bw-3",
      title: "White Wireless Gaming Headset",
      price: 159.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=150&auto=format&fit=crop&q=80",
    },
  ];

  const onsaleList = [
    {
      id: "bw-4",
      title: "Cellular Smart Watch Series 7",
      price: 180.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=150&auto=format&fit=crop&q=80",
    },
    {
      id: "bw-5",
      title: "Tactical Action Camcorder HD",
      price: 320.00,
      rating: 4,
      imageUrl: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=150&auto=format&fit=crop&q=80",
    },
    {
      id: "bw-6",
      title: "Smartphone Edge Curved 256GB",
      price: 799.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=150&auto=format&fit=crop&q=80",
    },
  ];

  const topRatedList = [
    {
      id: "bw-7",
      title: "Gear S3 Classic LTE Smartwatch Dual",
      price: 685.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=150&auto=format&fit=crop&q=80",
    },
    {
      id: "bw-8",
      title: "Ultra HD 4K Digital Camera System",
      price: 1250.00,
      rating: 5,
      imageUrl: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=150&auto=format&fit=crop&q=80",
    },
    {
      id: "bw-9",
      title: "Pro Laser Color Multifunction Printer",
      price: 480.00,
      rating: 4,
      imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80",
    },
  ];

  return (
    <section className="py-14 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10">
        
        {/* Widget 1: Featured Products */}
        <div className="space-y-5">
          <h3 className="text-sm font-black text-slate-900 border-b-2 border-blue-600 pb-2.5 uppercase tracking-wider">
            Featured Products
          </h3>
          <div className="space-y-4">
            {featuredList.map((item) => (
              <div key={item.id} className="flex items-center space-x-4 group p-1.5 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-xl shrink-0 flex items-center justify-center p-1.5 shadow-2xs">
                  <img src={item.imageUrl} alt={item.title} className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform" />
                </div>
                <div>
                  <Link href={`/products/${item.id}`} className="text-xs font-bold text-slate-900 hover:text-blue-600 line-clamp-2 leading-tight block mb-1 transition-colors">
                    {item.title}
                  </Link>
                  <div className="flex items-center space-x-0.5 text-amber-400 mb-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-2.5 h-2.5 ${i < item.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                    ))}
                  </div>
                  <span className="text-xs font-black text-slate-900">${item.price.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Widget 2: Onsale Products */}
        <div className="space-y-5">
          <h3 className="text-sm font-black text-slate-900 border-b-2 border-blue-600 pb-2.5 uppercase tracking-wider">
            Onsale Products
          </h3>
          <div className="space-y-4">
            {onsaleList.map((item) => (
              <div key={item.id} className="flex items-center space-x-4 group p-1.5 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-xl shrink-0 flex items-center justify-center p-1.5 shadow-2xs">
                  <img src={item.imageUrl} alt={item.title} className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform" />
                </div>
                <div>
                  <Link href={`/products/${item.id}`} className="text-xs font-bold text-slate-900 hover:text-blue-600 line-clamp-2 leading-tight block mb-1 transition-colors">
                    {item.title}
                  </Link>
                  <div className="flex items-center space-x-0.5 text-amber-400 mb-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-2.5 h-2.5 ${i < item.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                    ))}
                  </div>
                  <span className="text-xs font-black text-slate-900">${item.price.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Widget 3: Top Rated Products */}
        <div className="space-y-5">
          <h3 className="text-sm font-black text-slate-900 border-b-2 border-blue-600 pb-2.5 uppercase tracking-wider">
            Top Rated Products
          </h3>
          <div className="space-y-4">
            {topRatedList.map((item) => (
              <div key={item.id} className="flex items-center space-x-4 group p-1.5 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-xl shrink-0 flex items-center justify-center p-1.5 shadow-2xs">
                  <img src={item.imageUrl} alt={item.title} className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform" />
                </div>
                <div>
                  <Link href={`/products/${item.id}`} className="text-xs font-bold text-slate-900 hover:text-blue-600 line-clamp-2 leading-tight block mb-1 transition-colors">
                    {item.title}
                  </Link>
                  <div className="flex items-center space-x-0.5 text-amber-400 mb-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-2.5 h-2.5 ${i < item.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                    ))}
                  </div>
                  <span className="text-xs font-black text-slate-900">${item.price.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Widget 4: Promo Banner Card */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between items-center text-center shadow-xl text-white">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
              SMART 3D GEAR
            </span>
            <h4 className="text-xl font-black uppercase tracking-tight mt-1">
              NOW FROM <span className="text-cyan-400">$129.99</span>
            </h4>
          </div>

          <div className="my-5 w-full h-36 relative flex items-center justify-center">
            <img
              src="https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=300&auto=format&fit=crop&q=80"
              alt="Smart 3D Promo"
              className="max-h-full max-w-full object-contain drop-shadow-xl hover:scale-105 transition-transform duration-500"
            />
          </div>

          <Link
            href="/products/smart-3d"
            className="inline-block bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-black text-xs px-7 py-3 rounded-full transition-transform hover:scale-105 shadow-md"
          >
            Shop Now &rarr;
          </Link>
        </div>

      </div>
    </section>
  );
};
