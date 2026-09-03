"use client";

import React, { useState } from "react";

export const NewsletterBar: React.FC = () => {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubscribed(true);
      setEmail("");
    }
  };

  return (
    <section className="bg-[#fed700] py-6 text-[#333e48]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Left Info */}
        <div className="flex items-center space-x-3 text-center md:text-left">
          <div className="p-2 bg-white/20 rounded-full shrink-0 hidden sm:block">
            <svg className="w-6 h-6 text-[#333e48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 002-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-extrabold tracking-tight">
              Sign up to Newsletter
            </h3>
            <p className="text-xs font-semibold text-[#333e48]/80">
              ...and receive $20 coupon for first shopping
            </p>
          </div>
        </div>

        {/* Right Input Form */}
        <form onSubmit={handleSubmit} className="flex w-full md:w-auto max-w-md rounded-full overflow-hidden shadow-xs">
          <input
            type="email"
            placeholder="Enter your email address..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1 px-5 py-3 text-sm bg-white text-gray-800 placeholder-gray-400 focus:outline-hidden"
          />
          <button
            type="submit"
            className="bg-[#333e48] hover:bg-black text-white font-bold text-sm px-6 py-3 transition-colors cursor-pointer"
          >
            {subscribed ? "Subscribed!" : "Sign up"}
          </button>
        </form>

      </div>
    </section>
  );
};
