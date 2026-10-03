"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/formatter";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistStore } from "@/stores/wishlist-store";
import { ShoppingCart } from "@/components/icons/ShoppingCart";

export interface ShowcaseProduct {
  id: string;
  slug?: string;
  name: string;
  description?: string | null;
  price: number;
  discountPrice?: number | null;
  stock: number;
  imageUrl?: string | null;
  images?: string[];
  category?: string;
  categorySlug?: string;
  rating?: number | null;
}

export interface ShowcaseCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  products: ShowcaseProduct[];
}

interface ElectroCategoryShowcaseProps {
  categories: ShowcaseCategory[];
  allProducts: ShowcaseProduct[];
}

// Electro-style Compare and Heart SVG icons
const CompareIcon = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 3h5v5" />
    <path d="M4 20L21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </svg>
);

const HeartIcon = ({
  className = "w-3.5 h-3.5",
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

export const ElectroCategoryShowcase: React.FC<ElectroCategoryShowcaseProps> = ({
  categories = [],
  allProducts = [],
}) => {
  const [activeSlug, setActiveSlug] = useState<string>("all");
  const [addedNoticeId, setAddedNoticeId] = useState<string | null>(null);
  const [selectedHeroImage, setSelectedHeroImage] = useState<string | null>(null);
  const addItem = useCartStore((state) => state.addItem);
  const { addItem: addWishlist, isInWishlist, removeItem: removeWishlist } = useWishlistStore();

  const handleAddToCart = (product: ShowcaseProduct, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (product.stock === 0) return;

    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      discountPrice: product.discountPrice,
      imageUrl: product.imageUrl || undefined,
      stock: product.stock,
      category: product.category,
      quantity: 1,
    });

    setAddedNoticeId(product.id);
    setTimeout(() => {
      setAddedNoticeId((prev) => (prev === product.id ? null : prev));
    }, 2000);
  };

  const handleToggleWishlist = (product: ShowcaseProduct, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isInWishlist(product.id)) {
      removeWishlist(product.id);
    } else {
      addWishlist({
        id: product.id,
        name: product.name,
        price: product.price,
        discountPrice: product.discountPrice,
        imageUrl: product.imageUrl || undefined,
        category: product.category,
      });
    }
  };

  // Determine current active products based on tab
  const activeCategory = categories.find((c) => c.slug === activeSlug);
  const currentProducts =
    activeSlug === "all"
      ? allProducts
      : activeCategory?.products || [];

  // Hero product is the first product
  const heroProduct = currentProducts[0] || allProducts[0] || null;
  // Other products for left and right columns
  const remainingProducts =
    currentProducts.length > 1
      ? currentProducts.slice(1)
      : allProducts.filter((p) => p.id !== heroProduct?.id);

  // Left Column gets items 0 and 1
  const leftItem1 = remainingProducts[0] || null;
  const leftItem2 = remainingProducts[1] || null;

  // Right Column gets items 2 and 3
  const rightItem1 = remainingProducts[2] || null;
  const rightItem2 = remainingProducts[3] || null;

  // Hero gallery images
  const heroGallery = heroProduct
    ? [
        heroProduct.imageUrl || "/placeholder-gadget.svg",
        ...(heroProduct.images || []),
      ].filter(Boolean)
    : [];

  const displayHeroImage =
    selectedHeroImage || heroProduct?.imageUrl || "/placeholder-gadget.svg";

  return (
    <div className="w-full">
      {/* 1. NAV CLASSIC (Tabs header exactly matching Electro template) */}
      <div className="relative text-center z-10 mb-4">
        <ul
          className="flex items-center justify-start lg:justify-center overflow-x-auto no-scrollbar border-b border-gray-200 pb-0 gap-1 sm:gap-2"
          role="tablist"
        >
          {/* "Best Deals" Tab */}
          <li className="shrink-0" role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={activeSlug === "all"}
              onClick={() => {
                setActiveSlug("all");
                setSelectedHeroImage(null);
              }}
              className={`px-4 sm:px-5 py-2.5 text-sm sm:text-[15px] font-bold transition-all relative cursor-pointer border-b-2 ${
                activeSlug === "all"
                  ? "text-[#333e48] border-[#fed700]"
                  : "text-[#77838f] hover:text-[#333e48] border-transparent"
              }`}
            >
              Best Deals
            </button>
          </li>

          {/* Individual Category Tabs */}
          {categories.map((cat) => {
            const isActive = activeSlug === cat.slug;
            return (
              <li key={cat.id} className="shrink-0" role="presentation">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveSlug(cat.slug);
                    setSelectedHeroImage(null);
                  }}
                  className={`px-4 sm:px-5 py-2.5 text-sm sm:text-[15px] font-bold transition-all relative cursor-pointer border-b-2 flex items-center gap-1.5 ${
                    isActive
                      ? "text-[#333e48] border-[#fed700]"
                      : "text-[#77838f] hover:text-[#333e48] border-transparent"
                  }`}
                >
                  <span>{cat.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 2. TAB CONTENT (Electro 3-Column Showcase Grid) */}
      <div className="bg-white border border-[#eaeaea] rounded-lg overflow-hidden shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-gray-200">
          
          {/* LEFT COLUMN: col-md-3 (2 Stacked Product Items) */}
          <div className="col-span-12 md:col-span-3 flex flex-col divide-y divide-gray-200">
            <StandardProductItem
              product={leftItem1}
              onAddToCart={handleAddToCart}
              onToggleWishlist={handleToggleWishlist}
              isAdded={addedNoticeId === leftItem1?.id}
              isWishlisted={leftItem1 ? isInWishlist(leftItem1.id) : false}
            />
            <StandardProductItem
              product={leftItem2}
              onAddToCart={handleAddToCart}
              onToggleWishlist={handleToggleWishlist}
              isAdded={addedNoticeId === leftItem2?.id}
              isWishlisted={leftItem2 ? isInWishlist(leftItem2.id) : false}
            />
          </div>

          {/* CENTER COLUMN: col-md-6 (Featured Hero Product Item) */}
          <div className="col-span-12 md:col-span-6 p-4 sm:p-6 flex flex-col justify-between bg-white relative group">
            {heroProduct ? (
              <>
                <div className="flex flex-col">
                  {/* Category Link */}
                  <div className="mb-1.5">
                    <Link
                      href={`/categories/${heroProduct.categorySlug || activeCategory?.slug || heroProduct.category?.toLowerCase() || ""}`}
                      className="text-xs text-[#77838f] hover:text-[#333e48] font-medium transition-colors"
                    >
                      {heroProduct.category || activeCategory?.name || "Featured"}
                    </Link>
                  </div>

                  {/* Product Title in Bold Blue */}
                  <h3 className="mb-2 font-bold text-base sm:text-lg text-[#0066cc] hover:text-[#004d99] transition-colors leading-snug line-clamp-2">
                    <Link href={`/products/${heroProduct.slug || heroProduct.id}`}>
                      {heroProduct.name}
                    </Link>
                  </h3>

                  {/* Centered Large Hero Image */}
                  <div className="my-3 w-full h-52 sm:h-64 flex items-center justify-center overflow-hidden">
                    <Link
                      href={`/products/${heroProduct.slug || heroProduct.id}`}
                      className="block w-full h-full relative flex items-center justify-center"
                    >
                      <img
                        src={displayHeroImage}
                        alt={heroProduct.name}
                        className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/placeholder-gadget.svg";
                        }}
                      />
                    </Link>
                  </div>

                  {/* Gallery Thumbnails (Electro style with border & active yellow ring) */}
                  <div className="flex items-center justify-center gap-2.5 my-2">
                    {heroGallery.slice(0, 3).map((thumb, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedHeroImage(thumb)}
                        className={`w-12 h-12 rounded border p-1 transition-all overflow-hidden bg-white cursor-pointer ${
                          displayHeroImage === thumb
                            ? "border-[#fed700] ring-2 ring-[#fed700]/50"
                            : "border-gray-200 hover:border-gray-400"
                        }`}
                        title="Click to view image"
                      >
                        <img
                          src={thumb}
                          alt="Gallery thumbnail"
                          className="w-full h-full object-contain"
                        />
                      </button>
                    ))}
                  </div>

                  {/* Price & Wide "Add to Cart" Button */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 flex-wrap gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl sm:text-2xl font-black text-[#333e48]">
                        {formatCurrency(heroProduct.discountPrice || heroProduct.price)}
                      </span>
                      {heroProduct.discountPrice &&
                        heroProduct.discountPrice < heroProduct.price && (
                          <span className="text-xs sm:text-sm text-gray-400 line-through">
                            {formatCurrency(heroProduct.price)}
                          </span>
                        )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAddToCart(heroProduct)}
                      disabled={heroProduct.stock === 0}
                      className={`h-10 px-5 rounded-full font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50 ${
                        addedNoticeId === heroProduct.id
                          ? "bg-emerald-500 text-white"
                          : "bg-[#fed700] hover:bg-[#eec800] text-[#333e48]"
                      }`}
                    >
                      <ShoppingCart className="w-4 h-4 text-[#333e48]" />
                      <span>
                        {addedNoticeId === heroProduct.id
                          ? "Added to Cart! ✓"
                          : "Add to Cart"}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Electro Card Footer with Compare & Add to Wishlist */}
                <div className="border-t border-gray-100 pt-3 mt-4 flex items-center justify-between text-xs text-[#77838f]">
                  <Link
                    href={`/compare?product=${heroProduct.id}`}
                    className="inline-flex items-center gap-1.5 hover:text-[#0066cc] transition-colors"
                  >
                    <CompareIcon className="w-3.5 h-3.5" />
                    <span>Compare</span>
                  </Link>

                  <button
                    type="button"
                    onClick={(e) => handleToggleWishlist(heroProduct, e)}
                    className="inline-flex items-center gap-1.5 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <HeartIcon
                      className={`w-3.5 h-3.5 ${
                        isInWishlist(heroProduct.id)
                          ? "fill-red-500 text-red-500"
                          : "text-gray-400"
                      }`}
                      filled={isInWishlist(heroProduct.id)}
                    />
                    <span>
                      {isInWishlist(heroProduct.id)
                        ? "In Wishlist"
                        : "Add to Wishlist"}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <div className="py-20 text-center text-xs text-gray-400">
                No featured product in this category
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: col-md-3 (2 Stacked Product Items) */}
          <div className="col-span-12 md:col-span-3 flex flex-col divide-y divide-gray-200">
            <StandardProductItem
              product={rightItem1}
              onAddToCart={handleAddToCart}
              onToggleWishlist={handleToggleWishlist}
              isAdded={addedNoticeId === rightItem1?.id}
              isWishlisted={rightItem1 ? isInWishlist(rightItem1.id) : false}
            />
            <StandardProductItem
              product={rightItem2}
              onAddToCart={handleAddToCart}
              onToggleWishlist={handleToggleWishlist}
              isAdded={addedNoticeId === rightItem2?.id}
              isWishlisted={rightItem2 ? isInWishlist(rightItem2.id) : false}
            />
          </div>

        </div>
      </div>

      {/* 3. ALL PRODUCTS IN SELECTED CATEGORY GRID */}
      <div className="mt-8 bg-white border border-[#eaeaea] rounded-lg p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-5 border-b-2 border-gray-200 gap-2">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base sm:text-xl font-black text-[#333e48] relative">
              {activeCategory ? `All ${activeCategory.name} Products` : "All Top Deals & Gadgets"}
              <span className="absolute -bottom-[14px] left-0 w-16 h-[3px] bg-[#fed700] rounded-full" />
            </h3>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#fed700]/25 text-[#333e48] border border-[#fed700]/40">
              {currentProducts.length} {currentProducts.length === 1 ? "Item" : "Items"}
            </span>
          </div>

          <span className="text-xs text-gray-500 font-medium">
            100% Genuine with Official Warranty in Bangladesh
          </span>
        </div>

        {currentProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {currentProducts.map((p) => (
              <div
                key={p.id}
                className="border border-gray-200 rounded-lg hover:border-[#fed700] hover:shadow-md transition-all duration-200 bg-white overflow-hidden flex flex-col justify-between"
              >
                <StandardProductItem
                  product={p}
                  onAddToCart={handleAddToCart}
                  onToggleWishlist={handleToggleWishlist}
                  isAdded={addedNoticeId === p.id}
                  isWishlisted={isInWishlist(p.id)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 px-4">
            <span className="text-3xl block mb-2">⚡</span>
            <p className="text-sm font-bold text-[#333e48]">
              No products available in {activeCategory?.name || "this category"} yet
            </p>
            <p className="text-xs text-gray-400 mt-1">
              New official stock will be added soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

interface StandardProductItemProps {
  product: ShowcaseProduct | null;
  onAddToCart: (p: ShowcaseProduct, e?: React.MouseEvent) => void;
  onToggleWishlist: (p: ShowcaseProduct, e: React.MouseEvent) => void;
  isAdded: boolean;
  isWishlisted: boolean;
}

const StandardProductItem: React.FC<StandardProductItemProps> = ({
  product,
  onAddToCart,
  onToggleWishlist,
  isAdded,
  isWishlisted,
}) => {
  if (!product) {
    return (
      <div className="flex-1 p-5 flex flex-col items-center justify-center text-center bg-gray-50/30 min-h-[220px]">
        <span className="text-2xl text-gray-300 mb-1">⚡</span>
        <span className="text-xs text-gray-400 font-medium">Coming Soon</span>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between group hover:bg-slate-50/40 transition-colors relative min-h-[220px]">
      <div>
        {/* Category Label */}
        <div className="mb-1">
          <Link
            href={`/categories/${product.categorySlug || product.category?.toLowerCase() || ""}`}
            className="text-xs text-[#77838f] hover:text-[#333e48] font-medium transition-colors"
          >
            {product.category || "Gadgets"}
          </Link>
        </div>

        {/* Product Title in Bold Blue */}
        <h4 className="font-bold text-sm text-[#0066cc] hover:text-[#004d99] transition-colors leading-snug line-clamp-2">
          <Link href={`/products/${product.slug || product.id}`}>
            {product.name}
          </Link>
        </h4>

        {/* Centered Image */}
        <div className="my-3 h-28 sm:h-32 w-full flex items-center justify-center overflow-hidden">
          <Link
            href={`/products/${product.slug || product.id}`}
            className="block w-full h-full relative flex items-center justify-center"
          >
            <img
              src={product.imageUrl || "/placeholder-gadget.svg"}
              alt={product.name}
              className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/placeholder-gadget.svg";
              }}
            />
          </Link>
        </div>

        {/* Price & Circular Add to Cart Button */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <span className="text-sm sm:text-base font-extrabold text-[#333e48]">
              {formatCurrency(product.discountPrice || product.price)}
            </span>
            {product.discountPrice && product.discountPrice < product.price && (
              <span className="block text-[11px] text-gray-400 line-through">
                {formatCurrency(product.price)}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => onAddToCart(product, e)}
            disabled={product.stock === 0}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-90 disabled:opacity-40 ${
              isAdded
                ? "bg-emerald-500 text-white"
                : "bg-[#fed700] hover:bg-[#eec800] text-[#333e48]"
            }`}
            title={isAdded ? "Added to Cart" : "Add to Cart"}
            aria-label="Add to cart"
          >
            {isAdded ? (
              <span className="text-xs font-bold">✓</span>
            ) : (
              <ShoppingCart className="w-4 h-4 text-[#333e48]" />
            )}
          </button>
        </div>
      </div>

      {/* Electro Card Footer with Compare & Add to Wishlist */}
      <div className="border-t border-gray-100 pt-2.5 mt-3 flex items-center justify-between text-xs text-[#77838f]">
        <Link
          href={`/compare?product=${product.id}`}
          className="inline-flex items-center gap-1 hover:text-[#0066cc] transition-colors"
        >
          <CompareIcon className="w-3.5 h-3.5" />
          <span>Compare</span>
        </Link>

        <button
          type="button"
          onClick={(e) => onToggleWishlist(product, e)}
          className="inline-flex items-center gap-1 hover:text-red-500 transition-colors cursor-pointer"
        >
          <HeartIcon
            className={`w-3.5 h-3.5 ${
              isWishlisted ? "fill-red-500 text-red-500" : "text-gray-400"
            }`}
            filled={isWishlisted}
          />
          <span>{isWishlisted ? "Wishlisted" : "Add to Wishlist"}</span>
        </button>
      </div>
    </div>
  );
};

