"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistStore } from "@/stores/wishlist-store";
import { useAuth } from "@/hooks/use-auth";
import { Search } from "@/components/icons/Search";
import { User } from "@/components/icons/User";
import { Menu } from "@/components/icons/Menu";
import { ChevronDown } from "@/components/icons/ChevronDown";
import { X } from "@/components/icons/X";

export const ElectroHeader: React.FC = () => {
  const { user, logout } = useAuth();
  const [isDepartmentOpen, setIsDepartmentOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All Categories");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeLang, setActiveLang] = useState("Dollar (US)");
  const [isLangOpen, setIsLangOpen] = useState(false);

  const pathname = usePathname();
  const cartItems = useCartStore((state) => state.items);
  const wishlistItems = useWishlistStore((state) => state.items);

  const totalCartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const totalCartPrice = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const wishlistCount = wishlistItems.length;

  // Close dropdowns on page change
  useEffect(() => {
    setIsDepartmentOpen(false);
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const categories = [
    { name: "Value of the Day", href: "/deals", isBold: true, hasSub: false },
    { name: "Top 100 Offers", href: "/deals", isBold: true, hasSub: false },
    { name: "New Arrivals", href: "/products?filter=new", isBold: true, hasSub: false },
    { name: "Smartphones & Tablets", href: "/products?category=smartphones", isBold: false, hasSub: true },
    { name: "Laptops & Computers", href: "/products?category=laptops", isBold: false, hasSub: true },
    { name: "Audio & Headphones", href: "/products?category=audio", isBold: false, hasSub: true },
    { name: "Smart Watches & Wearables", href: "/products?category=wearables", isBold: false, hasSub: true },
    { name: "Gaming & Consoles", href: "/products?category=gaming", isBold: false, hasSub: true },
    { name: "Cameras & Drones", href: "/products?category=cameras", isBold: false, hasSub: true },
  ];

  return (
    <header className="w-full bg-white text-[#333e48] border-b border-gray-200 z-50 relative lg:sticky lg:top-0 shadow-xs transition-all">
      {/* 1. TOPBAR - Spacious Padding & Larger Readable Typography */}
      <div className="hidden lg:block bg-slate-50/80 border-b border-gray-200/80 text-xs text-slate-600 py-2.5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-slate-600 font-semibold text-xs">Welcome to Amar Gadget Electronics Store</span>
          </div>

          <div className="flex items-center space-x-6 font-semibold text-xs text-slate-600">
            <Link href="/contact" className="hover:text-black flex items-center gap-2 transition-colors">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Store Locator</span>
            </Link>

            <span className="text-gray-300">|</span>

            <Link href="/track-order" className="hover:text-black flex items-center gap-2 transition-colors">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Track Your Order</span>
            </Link>

            <span className="text-gray-300">|</span>

            {/* Language / Currency Selector */}
            <div className="relative">
              <button
                onClick={() => setIsLangOpen(!isLangOpen)}
                className="flex items-center space-x-1.5 hover:text-black focus:outline-hidden cursor-pointer"
              >
                <span>{activeLang}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {isLangOpen && (
                <div className="absolute right-0 mt-2 w-36 bg-white border border-gray-200 text-gray-700 rounded-lg shadow-xl py-1 z-50 text-xs">
                  <button onClick={() => { setActiveLang("Dollar (US)"); setIsLangOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 font-medium">Dollar (US)</button>
                  <button onClick={() => { setActiveLang("BDT (৳)"); setIsLangOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 font-medium">BDT (৳)</button>
                  <button onClick={() => { setActiveLang("Euro (€)"); setIsLangOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 font-medium">Euro (€)</button>
                </div>
              )}
            </div>

            <span className="text-gray-300">|</span>

            {user ? (
              <div className="flex items-center space-x-3">
                <Link
                  href={user.role === "ADMIN" ? "/admin" : user.role === "MEMBER" ? "/member/dashboard" : "/user/dashboard"}
                  className="flex items-center space-x-2 hover:text-black font-bold transition"
                >
                  <div className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold overflow-hidden relative shadow-xs">
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.name || "User"} className="h-full w-full object-cover" />
                    ) : (
                      (user.name || user.email).charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="truncate max-w-32">{user.name || user.email.split("@")[0]}</span>
                  <span className="text-[10px] font-extrabold uppercase bg-primary/10 text-primary px-2 py-0.5 rounded-md">
                    {user.role}
                  </span>
                </Link>

                <button
                  onClick={logout}
                  className="text-slate-400 hover:text-destructive text-xs font-bold cursor-pointer transition-colors"
                  title="Sign Out"
                >
                  Logout
                </button>
              </div>
            ) : (
              <Link href="/login" className="hover:text-black flex items-center gap-2 transition-colors">
                <User className="w-4 h-4 text-slate-500" />
                <span>Register <span className="text-slate-400 font-normal">or</span> Sign in</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 2. MAIN HEADER - Compact Height */}
      <div className="py-2 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 lg:gap-8">

          {/* Left: Logo & Hamburger Menu */}
          <div className="flex items-center space-x-3">
            <Link href="/" className="flex items-center group">
              <div className="relative flex items-center">
                <span className="text-2xl sm:text-3xl font-black tracking-tight text-[#333e48]">
                  amar gadget
                </span>
                <span className="w-2.5 h-2.5 bg-[#fed700] rounded-full inline-block ml-0.5 mt-2.5 group-hover:scale-125 transition-transform"></span>
              </div>
            </Link>

            {/* Hamburger icon next to logo (Mobile only) */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden text-[#333e48] hover:text-black p-1 focus:outline-hidden cursor-pointer"
              aria-label="Open Menu"
            >
              <Menu className="w-6 h-6 text-[#333e48]" />
            </button>
          </div>

          {/* Center: Search Bar with Category Selector */}
          <div className="hidden md:flex flex-1 max-w-2xl mx-2">
            <form onSubmit={(e) => e.preventDefault()} className="flex items-center w-full h-10 rounded-full border-2 border-[#fed700] bg-white p-0.5 shadow-xs focus-within:ring-2 focus-within:ring-[#fed700]/50 transition-all">

              {/* Search Input on Left */}
              <input
                type="text"
                placeholder="Search for Products"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 pl-4 pr-3 py-1 text-xs sm:text-sm text-[#333e48] placeholder-gray-400 focus:outline-hidden bg-transparent"
              />

              {/* Category Select Dropdown on Right */}
              <div className="relative border-l border-gray-200 pl-2 pr-2 flex items-center shrink-0">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="pl-1 pr-5 py-1 text-xs font-semibold text-gray-600 bg-transparent appearance-none cursor-pointer focus:outline-hidden"
                >
                  <option>All Categories</option>
                  <option>Computers & Accessories</option>
                  <option>Cameras, Audio & Video</option>
                  <option>Mobiles & Tablets</option>
                  <option>TV & Audio</option>
                  <option>Watches & Eyewear</option>
                  <option>Accessories</option>
                </select>
                <ChevronDown className="w-3 h-3 text-gray-400 absolute right-1.5 pointer-events-none" />
              </div>

              {/* Circular Search Button on Far Right */}
              <button
                type="submit"
                className="w-8 h-8 rounded-full bg-[#fed700] hover:bg-[#eec800] text-[#333e48] flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-xs ml-0.5"
                aria-label="Search"
              >
                <Search className="w-4 h-4 text-[#333e48]" />
              </button>
            </form>
          </div>

          {/* Right: Action Icons (Compare, Wishlist, Cart) */}
          <div className="flex items-center space-x-5 lg:space-x-6">

            {/* Compare / Refresh Icon */}
            <Link href="/compare" className="hidden sm:flex items-center text-[#333e48] hover:text-black transition-colors relative group" title="Compare">
              <div className="relative">
                <svg className="w-5 h-5 text-[#333e48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="absolute -top-2 -right-2 bg-[#fed700] text-[#333e48] text-[9px] font-black rounded-full h-4 w-4 flex items-center justify-center shadow-xs">
                  0
                </span>
              </div>
            </Link>

            {/* Wishlist Heart Icon */}
            <Link href="/wishlist" className="hidden sm:flex items-center text-[#333e48] hover:text-black transition-colors relative group" title="Wishlist">
              <div className="relative">
                <svg className="w-5 h-5 text-[#333e48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span className="absolute -top-2 -right-2 bg-[#fed700] text-[#333e48] text-[9px] font-black rounded-full h-4 w-4 flex items-center justify-center shadow-xs">
                  {wishlistCount}
                </span>
              </div>
            </Link>

            {/* Cart Bag Icon & Total Price */}
            <Link href="/cart" className="flex items-center space-x-2 text-[#333e48] hover:opacity-90 transition-opacity">
              <div className="relative">
                <svg className="w-5.5 h-5.5 text-[#333e48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                <span className="absolute -top-2 -right-2 bg-[#fed700] text-[#333e48] text-[9px] font-black rounded-full h-4 w-4 flex items-center justify-center shadow-xs">
                  {totalCartCount}
                </span>
              </div>
              <span className="hidden sm:inline-block text-xs sm:text-sm font-black text-[#333e48] ml-1">
                ${totalCartPrice.toFixed(2)}
              </span>
            </Link>
          </div>
        </div>

        {/* Mobile Search Bar */}
        <div className="mt-2 px-4 md:hidden">
          <form onSubmit={(e) => e.preventDefault()} className="flex items-center w-full h-9 rounded-full border-2 border-[#fed700] bg-white p-0.5">
            <input
              type="text"
              placeholder="Search for Products"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 pl-4 text-xs text-[#333e48] placeholder-gray-400 focus:outline-hidden bg-transparent"
            />
            <button
              type="submit"
              className="w-7 h-7 rounded-full bg-[#fed700] text-[#333e48] flex items-center justify-center cursor-pointer shrink-0"
            >
              <Search className="w-3.5 h-3.5 text-[#333e48]" />
            </button>
          </form>
        </div>
      </div>

      {/* 3. NAVIGATION BAR & DEPARTMENTS MENU - Compact Height */}
      <div className="bg-white border-t border-gray-200 h-9">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-full">

          <div className="flex items-center space-x-6 sm:space-x-8 h-full">

            {/* All Departments Button */}
            <div className="relative w-56 sm:w-64 shrink-0 h-full flex items-end">
              <button
                onClick={() => setIsDepartmentOpen(!isDepartmentOpen)}
                className="w-full h-full bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-bold text-xs sm:text-sm px-3.5 rounded-t-lg flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Menu className="w-4 h-4 text-[#333e48]" />
                <span>All Departments</span>
              </button>

              {/* Department Dropdown Menu */}
              {isDepartmentOpen && (
                <div
                  className="absolute top-full left-0 w-full bg-white border border-gray-200 shadow-2xl z-50 py-1 rounded-b-lg"
                  onMouseLeave={() => setIsDepartmentOpen(false)}
                >
                  {categories.map((cat, idx) => (
                    <Link
                      key={idx}
                      href={cat.href}
                      className={`flex items-center justify-between px-4 py-1.5 text-xs text-gray-700 hover:bg-gray-100 hover:text-black transition-colors ${cat.isBold ? "font-bold text-[#333e48]" : "font-semibold"
                        }`}
                    >
                      <span>{cat.name}</span>
                      {cat.hasSub && <span className="text-gray-400 text-[10px] font-bold">&gt;</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Horizontal Nav Links */}
            <nav className="hidden lg:flex items-center space-x-6 text-xs sm:text-sm font-extrabold text-[#333e48] h-full">
              <Link
                href="/deals"
                className={`h-full flex items-center gap-1 border-b-2 transition-colors ${
                  pathname === "/deals"
                    ? "border-[#fed700] text-amber-600 font-black"
                    : "border-transparent text-[#DE4437] hover:text-red-700"
                }`}
              >
                <span>Super Deals</span>
                <ChevronDown className={`w-3 h-3 ${pathname === "/deals" ? "text-amber-600" : "text-[#DE4437]"}`} />
              </Link>
              <Link
                href="/brands"
                className={`h-full flex items-center border-b-2 transition-colors ${
                  pathname?.startsWith("/brands")
                    ? "border-[#fed700] text-black font-black"
                    : "border-transparent text-[#333e48] hover:text-black"
                }`}
              >
                Featured Brands
              </Link>
              <Link
                href="/products"
                className={`h-full flex items-center border-b-2 transition-colors ${
                  pathname === "/products" || (pathname?.startsWith("/products") && !pathname.includes("category"))
                    ? "border-[#fed700] text-black font-black"
                    : "border-transparent text-[#333e48] hover:text-black"
                }`}
              >
                All Products
              </Link>
              <Link
                href="/categories"
                className={`h-full flex items-center border-b-2 transition-colors ${
                  pathname?.startsWith("/categories")
                    ? "border-[#fed700] text-black font-black"
                    : "border-transparent text-[#333e48] hover:text-black"
                }`}
              >
                Categories
              </Link>
              <Link
                href="/about"
                className={`h-full flex items-center border-b-2 transition-colors ${
                  pathname === "/about"
                    ? "border-[#fed700] text-black font-black"
                    : "border-transparent text-[#333e48] hover:text-black"
                }`}
              >
                About Us
              </Link>
              <Link
                href="/contact"
                className={`h-full flex items-center border-b-2 transition-colors ${
                  pathname === "/contact"
                    ? "border-[#fed700] text-black font-black"
                    : "border-transparent text-[#333e48] hover:text-black"
                }`}
              >
                Contact
              </Link>
            </nav>
          </div>

          {/* Right shipping promo */}
          <div className="hidden xl:block text-xs font-semibold text-gray-600">
            <span>Free Shipping on Orders $50+</span>
          </div>
        </div>
      </div>

      {/* 4. MOBILE SLIDE-OUT DRAWER */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setIsMobileMenuOpen(false)}></div>
          <div className="relative w-80 max-w-full bg-white h-full shadow-2xl flex flex-col z-50 overflow-y-auto">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="text-2xl font-extrabold text-[#333e48]">
                amar gadget<span className="text-[#fed700]">.</span>
              </span>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1 rounded-full text-gray-500 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Menu List */}
            <div className="flex-1 py-4 px-3 space-y-1">
              <p className="px-3 text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Departments</p>
              {categories.map((cat, idx) => (
                <Link
                  key={idx}
                  href={cat.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`block px-3 py-2 text-sm rounded-lg hover:bg-gray-100 transition-colors ${cat.isBold ? "font-bold text-[#333e48]" : "font-medium text-gray-700"
                    }`}
                >
                  {cat.name}
                </Link>
              ))}

              <div className="border-t border-gray-100 my-4 pt-4">
                <p className="px-3 text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Account & Support</p>
                <Link href="/login" onClick={() => setIsMobileMenuOpen(false)} className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Register or Sign in</Link>
                <Link href="/track-order" onClick={() => setIsMobileMenuOpen(false)} className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Track Your Order</Link>
                <Link href="/contact" onClick={() => setIsMobileMenuOpen(false)} className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Store Locator</Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
