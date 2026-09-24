"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatter";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistStore } from "@/stores/wishlist-store";

interface ProductCardProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  discountPrice?: number | null;
  stock: number;
  imageUrl?: string;
  category?: string;
  rating?: number;
  onAddToCart?: (productId: string) => void;
  onAddToWishlist?: (productId: string) => void;
  className?: string;
}

export const ProductCard = ({
  id,
  name,
  description,
  price,
  discountPrice,
  stock,
  imageUrl,
  category,
  rating = 5,
  className = "",
}: ProductCardProps) => {
  const [addedNotice, setAddedNotice] = useState(false);
  const addItem = useCartStore((state) => state.addItem);
  const { addItem: addWishlist, isInWishlist, removeItem: removeWishlist } = useWishlistStore();

  const isWishlisted = isInWishlist(id);
  const effectivePrice = discountPrice || price;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (stock === 0) return;

    addItem({
      id,
      name,
      price,
      discountPrice,
      imageUrl,
      stock,
      category,
      quantity: 1,
    });

    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 2000);
  };

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isWishlisted) {
      removeWishlist(id);
    } else {
      addWishlist({
        id,
        name,
        price,
        discountPrice,
        imageUrl,
        category,
      });
    }
  };

  return (
    <Card
      className={`group relative overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between h-full ${className}`}
    >
      {/* Toast Notice when Added */}
      {addedNotice && (
        <div className="absolute top-2 inset-x-2 z-30 bg-emerald-600 text-white text-[10px] font-bold py-1 px-2.5 rounded-md shadow-md text-center animate-in fade-in slide-in-from-top-2">
          ✓ Added to Cart!
        </div>
      )}

      <div className="flex flex-col flex-1">
        {/* Product Image Stage - Fixed Uniform 1:1 Aspect Ratio Box across ALL cards */}
        <div className="relative w-full aspect-square overflow-hidden bg-white dark:bg-slate-900 p-2 flex items-center justify-center border-b border-slate-100 dark:border-slate-800/60">
          <Link href={`/products/${id}`} className="block relative w-full h-full">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={name}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className="object-contain w-full h-full p-2 drop-shadow-xs group-hover:scale-105 transition-transform duration-300 ease-out"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-slate-400 text-xs font-medium rounded-lg">
                No Image
              </div>
            )}
          </Link>

          {/* Badges Overlay */}
          <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 z-20 pointer-events-none">
            {stock === 0 ? (
              <Badge variant="destructive" className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 shadow-2xs">
                Out of Stock
              </Badge>
            ) : discountPrice ? (
              <Badge variant="default" className="bg-amber-500 text-slate-950 font-black text-[9px] uppercase tracking-wider px-2 py-0.5 shadow-2xs">
                SALE
              </Badge>
            ) : stock < 5 ? (
              <Badge variant="destructive" className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 shadow-2xs">
                Only {stock} Left
              </Badge>
            ) : null}
          </div>

          {/* Wishlist Button Overlay */}
          <button
            type="button"
            onClick={handleToggleWishlist}
            className={`absolute top-2.5 right-2.5 h-7 w-7 rounded-full flex items-center justify-center transition-all z-20 shadow-2xs cursor-pointer ${
              isWishlisted
                ? "bg-red-500 text-white shadow-red-500/20 scale-105"
                : "bg-white/90 dark:bg-slate-800/80 text-slate-500 dark:text-slate-300 hover:text-red-500 hover:bg-white"
            }`}
            title={isWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
          >
            {isWishlisted ? "♥" : "♡"}
          </button>
        </div>

        {/* Product Details Section - Minimalist Typography */}
        <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between bg-white dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1.5 gap-2">
              {category && (
                <span className="font-bold text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded shrink-0">
                  {category}
                </span>
              )}
              <div className="flex items-center gap-0.5 text-amber-500 font-bold text-[11px] ml-auto shrink-0">
                <span>★</span>
                <span className="text-slate-700 dark:text-slate-300">{rating.toFixed(1)}</span>
              </div>
            </div>

            <Link href={`/products/${id}`} className="block group/title">
              <h3 className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-100 group-hover/title:text-amber-600 dark:group-hover/title:text-amber-400 line-clamp-2 leading-snug transition-colors">
                {name}
              </h3>
            </Link>
          </div>
        </div>
      </div>

      {/* Footer Pricing & Sleek Add to Cart Button */}
      <div className="p-3 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800/80 mt-auto flex flex-col gap-2.5">
        <div className="flex items-center justify-between min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {formatCurrency(effectivePrice)}
            </span>
            {discountPrice && (
              <span className="text-[11px] text-slate-400 line-through font-normal">
                {formatCurrency(price)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${stock > 0 ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className={`text-[9px] font-bold uppercase tracking-wider ${stock > 0 ? "text-emerald-600" : "text-red-500"}`}>
              {stock > 0 ? "In Stock" : "Out"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddToCart}
          disabled={stock === 0}
          className={`w-full h-9 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
            stock === 0
              ? "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed"
              : "bg-[#fed700] hover:bg-[#eec800] active:scale-98 text-slate-900"
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-slate-900" />
          <span className="whitespace-nowrap">{stock === 0 ? "Sold Out" : "Add to Cart"}</span>
        </button>
      </div>
    </Card>
  );
};