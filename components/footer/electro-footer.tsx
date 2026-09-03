"use client";

import React from "react";
import Link from "next/link";

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

          <div className="space-y-1">
            <span className="text-xs text-gray-500 font-semibold block">Got Questions? Call us 24/7!</span>
            <span className="text-lg font-black text-[#333e48] block">(800) 8001-8588, (0123) 4567 89</span>
          </div>

          <div className="text-xs text-gray-500 space-y-1">
            <p className="font-semibold text-gray-700">Contact Info</p>
            <p>17 Princess Road, London, Greater London NW1 8JR, UK</p>
          </div>

          {/* Social Icons */}
          <div className="flex space-x-3 text-gray-600 pt-2">
            <a href="#" className="w-8 h-8 rounded-full bg-gray-100 hover:bg-[#fed700] hover:text-[#333e48] flex items-center justify-center transition-colors">
              f
            </a>
            <a href="#" className="w-8 h-8 rounded-full bg-gray-100 hover:bg-[#fed700] hover:text-[#333e48] flex items-center justify-center transition-colors">
              t
            </a>
            <a href="#" className="w-8 h-8 rounded-full bg-gray-100 hover:bg-[#fed700] hover:text-[#333e48] flex items-center justify-center transition-colors">
              y
            </a>
          </div>
        </div>

        {/* Column 2: Find It Fast */}
        <div className="space-y-3">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-[#333e48] border-b border-gray-200 pb-2">
            Find It Fast
          </h4>
          <ul className="space-y-2 text-xs font-semibold text-gray-600">
            <li><Link href="/categories/laptops" className="hover:text-black transition-colors">Laptops &amp; Computers</Link></li>
            <li><Link href="/categories/cameras" className="hover:text-black transition-colors">Cameras, Audio &amp; Video</Link></li>
            <li><Link href="/categories/mobiles" className="hover:text-black transition-colors">Mobiles &amp; Tablets</Link></li>
            <li><Link href="/categories/tv-audio" className="hover:text-black transition-colors">TV &amp; Audio</Link></li>
            <li><Link href="/categories/watches" className="hover:text-black transition-colors">Watches &amp; Eyewear</Link></li>
            <li><Link href="/categories/accessories" className="hover:text-black transition-colors">Car &amp; Accessories</Link></li>
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
          <p className="text-xs text-gray-500 leading-relaxed font-medium">
            Amar Gadget is a premier electronics &amp; gadgets marketplace offering genuine warranty, fast shipping, and top customer service.
          </p>
          <div className="pt-2">
            <span className="text-xs font-bold text-gray-700 block mb-1">We Accept:</span>
            <div className="flex space-x-2 text-xs font-bold text-gray-600">
              <span className="px-2.5 py-1 bg-gray-100 rounded border border-gray-200">VISA</span>
              <span className="px-2.5 py-1 bg-gray-100 rounded border border-gray-200">MasterCard</span>
              <span className="px-2.5 py-1 bg-gray-100 rounded border border-gray-200">PayPal</span>
            </div>
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
