"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useCartStore } from "@/stores/cart-store";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { ProductCard } from "@/components/shared/product-card";
import { formatCurrency } from "@/lib/formatter";

export interface DynamicProductItem {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  price: number;
  discountPrice?: number | null;
  stock: number;
  imageUrl?: string;
  category?: string;
  rating?: number;
}

interface SpecialDealSectionProps {
  specialProduct?: DynamicProductItem | null;
  featuredProducts?: DynamicProductItem[];
  onSaleProducts?: DynamicProductItem[];
  topRatedProducts?: DynamicProductItem[];
}

export const SpecialDealSection: React.FC<SpecialDealSectionProps> = ({
  specialProduct,
  featuredProducts = [],
  onSaleProducts = [],
  topRatedProducts = [],
}) => {
  const [activeTab, setActiveTab] = useState<"featured" | "onsale" | "toprated">("featured");
  const [showAll, setShowAll] = useState(false);
  const [addedNotice, setAddedNotice] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  // Live Countdown state
  const [timeLeft, setTimeLeft] = useState({
    days: 42,
    hours: 18,
    minutes: 34,
    seconds: 52,
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
        if (prev.minutes > 0) return { ...prev, minutes: 59, seconds: 59 };
        if (prev.hours > 0) return { ...prev, hours: prev.hours - 1, minutes: 59, seconds: 59 };
        if (prev.days > 0) return { ...prev, days: prev.days - 1, hours: 23, minutes: 59, seconds: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const effectiveSpecial = specialProduct || featuredProducts[0] || null;

  const productsData: Record<"featured" | "onsale" | "toprated", DynamicProductItem[]> = {
    featured: featuredProducts.length > 0 ? featuredProducts : [],
    onsale: onSaleProducts.length > 0 ? onSaleProducts : featuredProducts,
    toprated: topRatedProducts.length > 0 ? topRatedProducts : featuredProducts,
  };

  const currentProducts = productsData[activeTab];
  const ROW_LIMIT = 3;
  const visibleProducts = showAll ? currentProducts : currentProducts.slice(0, ROW_LIMIT);

  const handleTabChange = (tab: "featured" | "onsale" | "toprated") => {
    setActiveTab(tab);
    setShowAll(false);
  };

  const handleAddSpecialToCart = () => {
    if (!effectiveSpecial || effectiveSpecial.stock === 0) return;
    addItem({
      id: effectiveSpecial.id,
      name: effectiveSpecial.name,
      price: effectiveSpecial.price,
      discountPrice: effectiveSpecial.discountPrice,
      imageUrl: effectiveSpecial.imageUrl,
      stock: effectiveSpecial.stock,
      category: effectiveSpecial.category,
      quantity: 1,
    });
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 2000);
  };

  return (
    <section className="py-8 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Special Offer Card */}
        {effectiveSpecial ? (
          <div className="bg-white border-2 border-[#fed700] rounded-xl p-5 relative flex flex-col justify-between shadow-xs">
            {/* Discount Badge */}
            {effectiveSpecial.discountPrice && (
              <div className="absolute top-4 right-4 bg-[#fed700] text-[#333e48] text-xs font-black px-3 py-1.5 rounded-full uppercase shadow-xs">
                Save {formatCurrency(effectiveSpecial.price - effectiveSpecial.discountPrice)}
              </div>
            )}

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1">
                Special Offer
              </span>

              {/* Image */}
              <div className="w-full h-48 relative my-4 flex items-center justify-center">
                {effectiveSpecial.imageUrl ? (
                  <img
                    src={effectiveSpecial.imageUrl}
                    alt={effectiveSpecial.name}
                    className="max-h-full max-w-full object-contain hover:scale-105 transition-transform"
                  />
                ) : (
                  <div className="text-gray-300 text-xs">No Image</div>
                )}
              </div>

              {/* Title & Category */}
              {effectiveSpecial.category && (
                <span className="text-[11px] font-semibold text-gray-400 block mb-1">
                  {effectiveSpecial.category}
                </span>
              )}
              <Link
                href={`/products/${effectiveSpecial.slug || effectiveSpecial.id}`}
                className="text-sm font-extrabold text-[#333e48] hover:text-black leading-snug line-clamp-2 block mb-3 transition-colors"
              >
                {effectiveSpecial.name}
              </Link>

              {/* Pricing */}
              <div className="flex items-baseline space-x-2 mb-4">
                <span className="text-2xl font-black text-red-600">
                  {formatCurrency(effectiveSpecial.discountPrice || effectiveSpecial.price)}
                </span>
                {effectiveSpecial.discountPrice && (
                  <span className="text-sm text-gray-400 line-through font-semibold">
                    {formatCurrency(effectiveSpecial.price)}
                  </span>
                )}
              </div>

              {/* Stock Progress Bar */}
              <div className="space-y-1 text-xs mb-5">
                <div className="flex justify-between font-semibold text-gray-600">
                  <span>Available: <strong>{effectiveSpecial.stock}</strong></span>
                  <span>Status: <strong>{effectiveSpecial.stock > 0 ? "In Stock" : "Sold Out"}</strong></span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[#fed700] w-4/5 rounded-full"></div>
                </div>
              </div>
            </div>

            {/* Added to cart toast */}
            {addedNotice && (
              <div className="mb-3 p-2 text-xs font-bold text-emerald-800 bg-emerald-100 rounded text-center">
                ✓ Added to cart!
              </div>
            )}

            {/* Quick Add To Cart Button */}
            <button
              onClick={handleAddSpecialToCart}
              disabled={effectiveSpecial.stock === 0}
              className="w-full mb-4 py-2.5 px-4 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-bold text-xs uppercase tracking-wider rounded-lg transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Add to Cart</span>
            </button>

            {/* Countdown Timer */}
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500 mb-2 text-center">
                Hurry Up! Offer ends in:
              </p>
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="bg-gray-100 p-2 rounded-lg">
                  <span className="block text-base font-black text-[#333e48]">
                    {String(timeLeft.days).padStart(2, "0")}
                  </span>
                  <span className="text-[9px] uppercase text-gray-500 font-semibold">DAYS</span>
                </div>
                <div className="bg-gray-100 p-2 rounded-lg">
                  <span className="block text-base font-black text-[#333e48]">
                    {String(timeLeft.hours).padStart(2, "0")}
                  </span>
                  <span className="text-[9px] uppercase text-gray-500 font-semibold">HOURS</span>
                </div>
                <div className="bg-gray-100 p-2 rounded-lg">
                  <span className="block text-base font-black text-[#333e48]">
                    {String(timeLeft.minutes).padStart(2, "0")}
                  </span>
                  <span className="text-[9px] uppercase text-gray-500 font-semibold">MINS</span>
                </div>
                <div className="bg-gray-100 p-2 rounded-lg">
                  <span className="block text-base font-black text-[#333e48]">
                    {String(timeLeft.seconds).padStart(2, "0")}
                  </span>
                  <span className="text-[9px] uppercase text-gray-500 font-semibold">SECS</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex items-center justify-center text-gray-400 text-sm">
            No special offer available.
          </div>
        )}

        {/* Right Tabbed Product Grid */}
        <div className="lg:col-span-3 space-y-4">
          
          {/* Header Tabs Navigation */}
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <div className="flex space-x-6">
              <button
                onClick={() => handleTabChange("featured")}
                className={`text-base font-extrabold pb-2 border-b-2 transition-colors cursor-pointer ${
                  activeTab === "featured"
                    ? "border-[#fed700] text-[#333e48]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                Featured ({productsData.featured.length})
              </button>
              <button
                onClick={() => handleTabChange("onsale")}
                className={`text-base font-extrabold pb-2 border-b-2 transition-colors cursor-pointer ${
                  activeTab === "onsale"
                    ? "border-[#fed700] text-[#333e48]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                On Sale ({productsData.onsale.length})
              </button>
              <button
                onClick={() => handleTabChange("toprated")}
                className={`text-base font-extrabold pb-2 border-b-2 transition-colors cursor-pointer ${
                  activeTab === "toprated"
                    ? "border-[#fed700] text-[#333e48]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                Top Rated ({productsData.toprated.length})
              </button>
            </div>
          </div>

          {/* Product Cards Grid - Initial 1 Row (3 items) with See More button */}
          {visibleProducts.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    slug={product.slug}
                    name={product.name}
                    description={product.description}
                    price={product.price}
                    discountPrice={product.discountPrice}
                    stock={product.stock}
                    imageUrl={product.imageUrl}
                    category={product.category}
                    rating={product.rating || 5}
                  />
                ))}
              </div>

              {/* See More / See Less Button */}
              {currentProducts.length > ROW_LIMIT && (
                <div className="flex justify-center pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAll((prev) => !prev)}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border border-gray-300 bg-white hover:bg-[#fed700] hover:border-[#fed700] text-[#333e48] font-bold text-xs sm:text-sm shadow-xs hover:shadow transition-all duration-200 cursor-pointer active:scale-95 group"
                  >
                    <span>
                      {showAll
                        ? "See Less"
                        : `See More (${currentProducts.length - ROW_LIMIT} more)`}
                    </span>
                    <svg
                      className={`w-3.5 h-3.5 text-[#333e48] transition-transform duration-200 ${
                        showAll ? "rotate-180" : "group-hover:translate-y-0.5"
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="p-12 text-center text-gray-400 text-sm">
              No products found in this category.
            </div>
          )}

        </div>

      </div>
    </section>
  );
};
