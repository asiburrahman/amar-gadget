import React from "react";
import Link from "next/link";
import { PublicContactDetails } from "@/components/support/public-contact-details";
import { PublicMarketplaceSummary } from "@/components/content/public-marketplace-summary";

export const ElectroFooter: React.FC = () => {
  return (
    <footer className="bg-white border-t border-gray-200 text-[#333e48] pt-12 pb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
        
        {/* Column 1: Brand & Contact Info */}
        <div className="space-y-4">
          <Link href="/" className="inline-block">
            <span className="text-3xl font-extrabold tracking-tight text-[#333e48]">
              amar gadget<span className="text-[#fed700]">.</span>
            </span>
          </Link>

          <PublicContactDetails compact />

        </div>

        {/* Column 2: Find It Fast */}
        <div className="space-y-3">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-[#333e48] border-b border-gray-200 pb-2">
            Find It Fast
          </h4>
          <ul className="space-y-2 text-xs font-semibold text-gray-600">
            <li><Link href="/categories" className="hover:text-black transition-colors">Browse Categories</Link></li>
            <li><Link href="/products" className="hover:text-black transition-colors">All Products</Link></li>
            <li><Link href="/brands" className="hover:text-black transition-colors">Browse Brands</Link></li>
            <li><Link href="/deals" className="hover:text-black transition-colors">Current Deals</Link></li>
            <li><Link href="/compare" className="hover:text-black transition-colors">Compare Products</Link></li>
            <li><Link href="/wishlist" className="hover:text-black transition-colors">Your Wishlist</Link></li>
          </ul>
        </div>

        {/* Column 3: Customer Care */}
        <div className="space-y-3">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-[#333e48] border-b border-gray-200 pb-2">
            Customer Care
          </h4>
          <ul className="space-y-2 text-xs font-semibold text-gray-600">
            <li><Link href="/account" className="hover:text-black transition-colors">My Account</Link></li>
            <li><Link href="/track-order" className="hover:text-black transition-colors">Track your Order</Link></li>
            <li><Link href="/wishlist" className="hover:text-black transition-colors">Wishlist</Link></li>
            <li><Link href="/contact" className="hover:text-black transition-colors">Customer Service</Link></li>
            <li><Link href="/returns" className="hover:text-black transition-colors">Returns / Exchange</Link></li>
            <li><Link href="/faq" className="hover:text-black transition-colors">FAQs</Link></li>
          </ul>
        </div>

        {/* Column 4: Customer Service Info */}
        <div className="space-y-3">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-[#333e48] border-b border-gray-200 pb-2">
            Store Information
          </h4>
          <PublicMarketplaceSummary />
          <div className="pt-2">
            <p className="text-xs text-gray-600">Review available payment methods and charges at checkout.</p>
          </div>
        </div>

      </div>

      {/* Bottom Bar */}
      <div className="border-t border-gray-200 pt-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 font-semibold gap-3">
          <p>© {new Date().getFullYear()} Amar Gadget - All Rights Reserved</p>
          <div className="flex space-x-4">
            <Link href="/privacy-policy" className="hover:text-black">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-black">Terms &amp; Conditions</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
