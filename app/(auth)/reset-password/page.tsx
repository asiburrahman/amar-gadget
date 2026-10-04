"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !otp || !newPassword) return;

    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "উভয় পাসওয়ার্ড এক হতে হবে।" });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          otp,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({
          type: "success",
          text: data.message || "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে! লগইন পেইজে পাঠানো হচ্ছে...",
        });
        setTimeout(() => {
          router.push("/login");
        }, 2000);
      } else {
        setMessage({
          type: "error",
          text: data.message || "পাসওয়ার্ড রিসেট ব্যর্থ হয়েছে। ওটিপি কোড সঠিক কিনা চেক করুন।",
        });
      }
    } catch (err: any) {
      setMessage({
        type: "error",
        text: err.message || "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-2 shadow-xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-[#333e48]">পাসওয়ার্ড রিসেট সম্পন্ন করুন</h1>
          <p className="text-xs text-slate-500">
            আপনার ইমেইলে প্রাপ্ত ৬-সংখ্যার OTP কোড এবং নতুন পাসওয়ার্ড প্রদান করুন।
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#333e48]">ইমেইল এড্রেস (Email Address) *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#333e48]">৬-সংখ্যার OTP কোড (Verification Code) *</label>
            <input
              type="text"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="123456"
              className="w-full px-4 py-2.5 text-center font-mono tracking-widest text-base font-black text-[#333e48] border-2 border-[#fed700] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition bg-amber-50/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#333e48]">নতুন পাসওয়ার্ড (New Password) *</label>
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="কমপক্ষে ৬ অক্ষর"
              className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#333e48]">নতুন পাসওয়ার্ড পুনরায় লিখুন (Confirm Password) *</label>
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="পুনরায় একই পাসওয়ার্ড লিখুন"
              className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
            />
          </div>

          <div className="flex items-center text-xs">
            <label className="flex items-center space-x-2 text-slate-600 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                className="rounded border-gray-300 text-[#fed700] focus:ring-[#fed700]"
              />
              <span>পাসওয়ার্ড দেখুন (Show Password)</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
                <span>রিসেট হচ্ছে...</span>
              </>
            ) : (
              <span>পাসওয়ার্ড সংরক্ষণ করুন (Save New Password)</span>
            )}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-gray-100">
          <Link href="/login" className="text-xs font-bold text-slate-500 hover:text-black">
            ← লগইন পেইজে ফিরে যান (Back to Login)
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-xs">Loading form...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}