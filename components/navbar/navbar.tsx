'use client';

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Sun } from "@/components/icons/Sun";
import { Search } from "@/components/icons/Search";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { User } from "@/components/icons/User";
import { Menu } from "@/components/icons/Menu";
import { ChevronDown } from "@/components/icons/ChevronDown";
import { X } from "@/components/icons/X";

interface NavbarProps {
  className?: string;
}

export const Navbar = ({ className = "" }: NavbarProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const toggleCategoryDropdown = () => setIsCategoryDropdownOpen(!isCategoryDropdownOpen);

  const navLinks = [
    { name: "Home", href: "/" },
    { name: "Products", href: "/products" },
    { name: "Categories", href: "/categories" },
    { name: "Brands", href: "/brands" },
    { name: "Deals", href: "/deals" },
    { name: "Blog", href: "/blog" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
      {/* Desktop & Main Bar */}
      <nav className={`flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto ${className}`}>
        
        {/* Left: Brand Logo & Desktop Navigation Links */}
        <div className="flex items-center space-x-6 lg:space-x-8">
          <Link href="/" className="flex items-center space-x-2.5 group">
            <div className="h-9 w-9 flex items-center justify-center bg-primary text-primary-foreground rounded-xl font-extrabold text-base shadow-sm group-hover:scale-105 transition-transform duration-200">
              AG
            </div>
            <span className="font-bold text-xl tracking-tight text-foreground bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
              Amar Gadget
            </span>
          </Link>

          {/* Desktop Primary Navigation Links */}
          <div className="hidden lg:flex items-center space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>

        {/* Center: Search Bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-6">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search gadgets, smartphones, laptops..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 h-9 text-sm bg-muted/40 border-muted-foreground/20 focus-visible:bg-background transition-colors"
            />
          </div>
        </div>

        {/* Right: Actions (Cart, Account, Theme, Mobile Hamburger) */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          
          {/* Categories Dropdown */}
          <div className="relative hidden sm:block">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCategoryDropdown}
              className="flex items-center space-x-1.5 text-sm font-medium text-foreground hover:bg-muted/80"
            >
              <span>Categories</span>
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isCategoryDropdownOpen ? "rotate-180" : ""}`} />
            </Button>
            
            {isCategoryDropdownOpen && (
              <div 
                className="absolute right-0 mt-2 w-64 p-4 bg-background border border-border rounded-xl shadow-xl z-50"
                onMouseLeave={() => setIsCategoryDropdownOpen(false)}
              >
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Popular Categories</h3>
                    <div className="grid grid-cols-1 gap-1 text-sm">
                      <Link href="/categories/smartphones" className="px-2 py-1.5 rounded-md hover:bg-muted hover:text-primary transition-colors">Smartphones</Link>
                      <Link href="/categories/laptops" className="px-2 py-1.5 rounded-md hover:bg-muted hover:text-primary transition-colors">Laptops & Computers</Link>
                      <Link href="/categories/audio" className="px-2 py-1.5 rounded-md hover:bg-muted hover:text-primary transition-colors">Audio & Headphones</Link>
                      <Link href="/categories/wearables" className="px-2 py-1.5 rounded-md hover:bg-muted hover:text-primary transition-colors">Smart Watches</Link>
                      <Link href="/categories/gaming" className="px-2 py-1.5 rounded-md hover:bg-muted hover:text-primary transition-colors">Gaming Gear</Link>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cart Icon Link */}
          <Link href="/cart" className="relative inline-flex items-center justify-center">
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-foreground hover:bg-muted" aria-label="Cart">
              <ShoppingCart className="h-4 w-4" />
            </Button>
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] font-bold rounded-full"
            >
              0
            </Badge>
          </Link>

          {/* Account Link */}
          <Link href="/login" className="hidden sm:inline-flex">
            <Button variant="ghost" size="sm" className="h-9 px-3 text-sm font-medium text-foreground hover:bg-muted">
              <User className="h-4 w-4 mr-1.5" />
              <span>Account</span>
            </Button>
          </Link>

          {/* Mobile Hamburger Toggle Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMenu}
            className="h-9 w-9 p-0 lg:hidden text-foreground hover:bg-muted"
            aria-label="Toggle Navigation Menu"
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile Drawer Navigation Menu */}
      {isMenuOpen && (
        <div className="lg:hidden border-t border-border bg-background px-4 pt-3 pb-6 space-y-4 shadow-lg">
          
          {/* Mobile Search */}
          <div className="relative md:hidden">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 h-9 text-sm"
            />
          </div>

          {/* Mobile Links */}
          <nav className="grid grid-cols-2 gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </nav>

          {/* Mobile Auth Actions */}
          <div className="border-t border-border pt-4 flex items-center gap-3">
            <Link
              href="/login"
              onClick={() => setIsMenuOpen(false)}
              className="flex-1 text-center px-4 py-2 rounded-lg border border-input text-sm font-medium hover:bg-accent transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              onClick={() => setIsMenuOpen(false)}
              className="flex-1 text-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Sign Up
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};