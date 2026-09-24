"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useCartStore } from "@/stores/cart-store";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { ProductCard } from "@/components/shared/product-card";

interface ProductItem {
  id: string;
  category: string;
  title: string;
  price: number;
  originalPrice?: number;
  imageUrl: string;
}

export const SpecialDealSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"featured" | "onsale" | "toprated">("featured");
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

  const specialOfferProduct = {
    id: "special-xbox-controller",
    category: "Game Consoles",
    title: "Game Console Wireless Controller + PC Adapter",
    price: 75.00,
    originalPrice: 195.00,
    discount: "Save $120",
    imageUrl: "https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=500&auto=format&fit=crop&q=80",
    available: 6,
    sold: 28,
  };

  const productsData: Record<"featured" | "onsale" | "toprated", ProductItem[]> = {
    featured: [
      {
        id: "prod-1",
        category: "Speakers",
        title: "Wireless Audio Speakers with Bluetooth 5.0",
        price: 685.00,
        imageUrl: "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-2",
        category: "Laptops",
        title: "Tablet Air 3 WiFi 64GB Silver Touch",
        price: 1215.00,
        originalPrice: 1350.00,
        imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-3",
        category: "Headphones",
        title: "Portable Over-Ear Wireless Headphones",
        price: 215.00,
        imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-4",
        category: "Smartphones",
        title: "Gear S3 Classic LTE Smartwatch Dual",
        price: 685.00,
        imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-5",
        category: "Cameras",
        title: "Ultra HD 4K Action Camera Waterproof",
        price: 525.00,
        imageUrl: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-6",
        category: "Printers",
        title: "Multifunction Color Laser All-In-One Printer",
        price: 480.00,
        imageUrl: "https://images.unsplash.com/photo-1612815150566-985e79c31923?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-7",
        category: "Gaming",
        title: "Gaming Controller Station White Edition",
        price: 599.00,
        imageUrl: "https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-8",
        category: "Security",
        title: "Smart Home Security Camera Wireless 1080p",
        price: 685.00,
        imageUrl: "https://images.unsplash.com/photo-1558002038-1055907df827?w=300&auto=format&fit=crop&q=80",
      },
    ],
    onsale: [
      {
        id: "prod-2",
        category: "Laptops",
        title: "Tablet Air 3 WiFi 64GB Silver Touch",
        price: 1215.00,
        originalPrice: 1350.00,
        imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-3",
        category: "Headphones",
        title: "Portable Over-Ear Wireless Headphones",
        price: 215.00,
        imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-7",
        category: "Gaming",
        title: "Gaming Controller Station White Edition",
        price: 599.00,
        imageUrl: "https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-8",
        category: "Security",
        title: "Smart Home Security Camera Wireless 1080p",
        price: 685.00,
        imageUrl: "https://images.unsplash.com/photo-1558002038-1055907df827?w=300&auto=format&fit=crop&q=80",
      },
    ],
    toprated: [
      {
        id: "prod-4",
        category: "Smartphones",
        title: "Gear S3 Classic LTE Smartwatch Dual",
        price: 685.00,
        imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-1",
        category: "Speakers",
        title: "Wireless Audio Speakers with Bluetooth 5.0",
        price: 685.00,
        imageUrl: "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-5",
        category: "Cameras",
        title: "Ultra HD 4K Action Camera Waterproof",
        price: 525.00,
        imageUrl: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=300&auto=format&fit=crop&q=80",
      },
      {
        id: "prod-6",
        category: "Printers",
        title: "Multifunction Color Laser All-In-One Printer",
        price: 480.00,
        imageUrl: "https://images.unsplash.com/photo-1612815150566-985e79c31923?w=300&auto=format&fit=crop&q=80",
      },
    ],
  };

  const currentProducts = productsData[activeTab];

  return (
    <section className="py-8 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Special Offer Card */}
        <div className="bg-white border-2 border-[#fed700] rounded-xl p-5 relative flex flex-col justify-between shadow-xs">
          {/* Discount Badge */}
          <div className="absolute top-4 right-4 bg-[#fed700] text-[#333e48] text-xs font-black px-3 py-1.5 rounded-full uppercase shadow-xs">
            {specialOfferProduct.discount}
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1">
              Special Offer
            </span>

            {/* Image */}
            <div className="w-full h-48 relative my-4 flex items-center justify-center">
              <img
                src={specialOfferProduct.imageUrl}
                alt={specialOfferProduct.title}
                className="max-h-full max-w-full object-contain hover:scale-105 transition-transform"
              />
            </div>

            {/* Title & Category */}
            <span className="text-[11px] font-semibold text-gray-400 block mb-1">
              {specialOfferProduct.category}
            </span>
            <Link
              href="/products/special-xbox-controller"
              className="text-sm font-extrabold text-[#333e48] hover:text-black leading-snug line-clamp-2 block mb-3 transition-colors"
            >
              {specialOfferProduct.title}
            </Link>

            {/* Pricing */}
            <div className="flex items-baseline space-x-2 mb-4">
              <span className="text-2xl font-black text-red-600">
                ${specialOfferProduct.price.toFixed(2)}
              </span>
              <span className="text-sm text-gray-400 line-through font-semibold">
                ${specialOfferProduct.originalPrice.toFixed(2)}
              </span>
            </div>

            {/* Stock Progress Bar */}
            <div className="space-y-1 text-xs mb-5">
              <div className="flex justify-between font-semibold text-gray-600">
                <span>Available: <strong>{specialOfferProduct.available}</strong></span>
                <span>Already Sold: <strong>{specialOfferProduct.sold}</strong></span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-[#fed700] w-4/5 rounded-full"></div>
              </div>
            </div>
          </div>

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

        {/* Right Tabbed Product Grid */}
        <div className="lg:col-span-3 space-y-4">
          
          {/* Header Tabs Navigation */}
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <div className="flex space-x-6">
              <button
                onClick={() => setActiveTab("featured")}
                className={`text-base font-extrabold pb-2 border-b-2 transition-colors cursor-pointer ${
                  activeTab === "featured"
                    ? "border-[#fed700] text-[#333e48]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                Featured
              </button>
              <button
                onClick={() => setActiveTab("onsale")}
                className={`text-base font-extrabold pb-2 border-b-2 transition-colors cursor-pointer ${
                  activeTab === "onsale"
                    ? "border-[#fed700] text-[#333e48]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                On Sale
              </button>
              <button
                onClick={() => setActiveTab("toprated")}
                className={`text-base font-extrabold pb-2 border-b-2 transition-colors cursor-pointer ${
                  activeTab === "toprated"
                    ? "border-[#fed700] text-[#333e48]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                Top Rated
              </button>
            </div>
          </div>

          {/* Product Cards Grid - 3 Spacious Columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {currentProducts.map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                name={product.title}
                price={product.price}
                discountPrice={product.originalPrice}
                stock={10}
                imageUrl={product.imageUrl}
                category={product.category}
                rating={4.8}
              />
            ))}
          </div>

        </div>

      </div>
    </section>
  );
};
