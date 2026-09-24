"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useWishlistStore } from "@/stores/wishlist-store";
import { useCartStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { Trash } from "@/components/icons/Trash";
import { Button } from "@/components/ui/button";

export default function WishlistPage() {
  const { items, removeItem, clearWishlist } = useWishlistStore();
  const addItemToCart = useCartStore((state) => state.addItem);

  const handleMoveToCart = (item: any) => {
    addItemToCart({
      id: item.id,
      name: item.name,
      price: item.price,
      discountPrice: item.discountPrice,
      imageUrl: item.imageUrl ?? undefined,
      stock: 10,
      quantity: 1,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 py-10 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Header Breadcrumb & Title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1">
              <Link href="/" className="hover:text-amber-600 transition-colors">Home</Link>
              <span>/</span>
              <span className="text-slate-900 dark:text-white font-bold">Wishlist</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
              <span>My Saved Wishlist</span>
              <span className="text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-1 rounded-full border border-amber-500/20">
                {items.length} {items.length === 1 ? "Item" : "Items"}
              </span>
            </h1>
          </div>

          {items.length > 0 && (
            <button
              onClick={clearWishlist}
              className="text-xs font-bold text-slate-500 hover:text-red-600 transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              <Trash className="w-3.5 h-3.5" />
              <span>Clear Wishlist</span>
            </button>
          )}
        </div>

        {/* Empty Wishlist State */}
        {items.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-12 text-center max-w-xl mx-auto shadow-xs my-8 space-y-5">
            <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto text-3xl">
              ♥
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Your Wishlist is Empty</h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Explore our flagship collection of smartphones, laptops, audio gear, and accessories to save your favorites.
              </p>
            </div>
            <Link href="/products" className="inline-block">
              <Button className="h-11 px-8 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-md">
                Browse Products &rarr;
              </Button>
            </Link>
          </div>
        ) : (
          /* Wishlist Items List */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => {
              const effectivePrice = item.discountPrice || item.price;
              return (
                <div
                  key={item.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-xs hover:shadow-xl transition-all duration-300 group"
                >
                  <div className="space-y-3">
                    {/* Image Stage */}
                    <div className="relative w-full h-48 bg-slate-50/50 dark:bg-slate-800/40 rounded-xl overflow-hidden p-3 flex items-center justify-center">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={item.name}
                          fill
                          className="object-contain p-2 drop-shadow-md group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="text-xs text-slate-400">No Image</div>
                      )}
                      
                      <button
                        onClick={() => removeItem(item.id)}
                        className="absolute top-2.5 right-2.5 h-8 w-8 rounded-full bg-white/90 dark:bg-slate-800 text-slate-400 hover:text-red-500 hover:bg-white shadow-sm flex items-center justify-center transition-all cursor-pointer"
                        title="Remove from wishlist"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Meta & Title */}
                    <div>
                      {item.category && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md inline-block mb-1.5">
                          {item.category}
                        </span>
                      )}
                      <Link href={`/products/${item.id}`} className="block group/title">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover/title:text-amber-600 transition-colors line-clamp-2 leading-snug">
                          {item.name}
                        </h3>
                      </Link>
                    </div>
                  </div>

                  {/* Pricing & Add to Cart Action */}
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800 mt-4 space-y-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-black text-slate-900 dark:text-white">
                        {formatCurrency(effectivePrice)}
                      </span>
                      {item.discountPrice && (
                        <span className="text-xs text-slate-400 line-through">
                          {formatCurrency(item.price)}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleMoveToCart(item)}
                      className="w-full h-10 rounded-xl bg-amber-400 hover:bg-amber-500 active:scale-98 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md cursor-pointer"
                    >
                      <ShoppingCart className="w-4 h-4 text-slate-950" />
                      <span>Add to Cart</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}