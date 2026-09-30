"use client";

import React from "react";
import Link from "next/link";
import { Star } from "@/components/icons/Star";
import { formatCurrency } from "@/lib/formatter";

export interface BottomProductItem {
  id: string;
  slug?: string;
  name: string;
  price: number;
  discountPrice?: number | null;
  rating?: number;
  imageUrl?: string;
}

interface BottomWidgetsProps {
  featuredProducts?: BottomProductItem[];
  onSaleProducts?: BottomProductItem[];
  topRatedProducts?: BottomProductItem[];
}

export const BottomWidgets: React.FC<BottomWidgetsProps> = ({
  featuredProducts = [],
  onSaleProducts = [],
  topRatedProducts = [],
}) => {
  const featuredList = featuredProducts.slice(0, 3);
  const onsaleList = onSaleProducts.slice(0, 3);
  const topRatedList = topRatedProducts.slice(0, 3);

  const renderColumn = (title: string, items: BottomProductItem[]) => (
    <div className="space-y-5">
      <h3 className="text-sm font-black text-slate-900 border-b-2 border-blue-600 pb-2.5 uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-4">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} className="flex items-center space-x-4 group p-1.5 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-xl shrink-0 flex items-center justify-center p-1.5 shadow-2xs">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="text-[10px] text-slate-300">No Image</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/products/${item.slug || item.id}`} className="text-xs font-bold text-slate-900 hover:text-blue-600 line-clamp-2 leading-tight block mb-1 transition-colors">
                  {item.name}
                </Link>
                <div className="flex items-center space-x-0.5 text-amber-400 mb-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-2.5 h-2.5 ${i < Math.round(item.rating || 5) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                  ))}
                </div>
                <div className="flex items-baseline space-x-1.5">
                  <span className="text-xs font-black text-slate-900">
                    {formatCurrency(item.discountPrice || item.price)}
                  </span>
                  {item.discountPrice && (
                    <span className="text-[10px] text-slate-400 line-through">
                      {formatCurrency(item.price)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-xs text-slate-400 py-4">No products available</div>
        )}
      </div>
    </div>
  );

  return (
    <section className="py-14 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10">
        
        {/* Widget 1: Featured Products */}
        {renderColumn("Featured Products", featuredList)}

        {/* Widget 2: On Sale Products */}
        {renderColumn("Onsale Products", onsaleList)}

        {/* Widget 3: Top Rated Products */}
        {renderColumn("Top Rated Products", topRatedList)}

        {/* Widget 4: Promo Banner Card */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between items-center text-center shadow-xl text-white">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
              SMART TECH DEALS
            </span>
            <h4 className="text-xl font-black uppercase tracking-tight mt-1">
              EXPLORE TOP GEAR
            </h4>
          </div>

          <div className="my-5 w-full h-36 relative flex items-center justify-center">
            <img
              src="https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=300&auto=format&fit=crop&q=80"
              alt="Smart Tech Promo"
              className="max-h-full max-w-full object-contain drop-shadow-xl hover:scale-105 transition-transform duration-500"
            />
          </div>

          <Link
            href="/products"
            className="inline-block bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-black text-xs px-7 py-3 rounded-full transition-transform hover:scale-105 shadow-md"
          >
            Browse All &rarr;
          </Link>
        </div>

      </div>
    </section>
  );
};
