"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [otpSent, setOtpSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        setMessage({
          type: "success",
          text: data.message || "পাসওয়ার্ড রিসেট ওটিপি কোড আপনার ইমেইলে পাঠানো হয়েছে।",
        });
      } else {
        setMessage({
          type: "error",
          text: data.message || "Failed to send reset code.",
        });
      }
    } catch (err: any) {
      setMessage({
        type: "error",
        text: err.message || "An error occurred. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto mb-2 shadow-xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-[#333e48]">পাসওয়ার্ড ভুলে গেছেন?</h1>
          <p className="text-xs text-slate-500">
            আপনার নিবন্ধিত ইমেইল এড্রেস লিখুন। আমরা আপনাকে একটি ৬-সংখ্যার OTP কোড পাঠাবো।
          </p>
        </div>

        {message && (
          <div
            className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
              message.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            <span>{message.type === "success" ? "✓" : "⚠️"}</span>
            <span>{message.text}</span>
          </div>
        )}

        {!otpSent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333e48]">ইমেইল এড্রেস (Email Address)</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
                  <span>কোড পাঠানো হচ্ছে...</span>
                </>
              ) : (
                <span>রিসেট কোড পাঠান (Send Reset OTP)</span>
              )}
            </button>
          </form>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 space-y-2">
              <p className="font-bold">কোড পাঠানো সম্পন্ন হয়েছে!</p>
              <p>
                <span className="font-semibold">{email}</span> ঠিকানায় প্রেরিত ৬-সংখ্যার OTP কোডটি দিয়ে পাসওয়ার্ড রিসেট সম্পন্ন করুন।
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push(`/reset-password?email=${encodeURIComponent(email)}`)}
              className="w-full py-3 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-2"
            >
              <span>পাসওয়ার্ড রিসেট করুন (Enter OTP & Reset)</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}

        <div className="text-center pt-2 border-t border-gray-100">
          <Link href="/login" className="text-xs font-bold text-slate-500 hover:text-black">
            ← লগইন পেইজে ফিরে যান (Back to Login)
          </Link>
        </div>
      </div>
    </div>
  );
}