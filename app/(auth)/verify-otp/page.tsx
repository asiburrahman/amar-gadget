"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { H1 } from "@/components/ui/typography";

function VerifyOtpForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length < 6) {
      setErrorMsg("Please enter the complete 6-digit OTP code.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.message || "Invalid OTP code. Please check your email.");
        setLoading(false);
        return;
      }

      setSuccessMsg("✓ Email verified successfully! Redirecting to your dashboard...");

      setTimeout(() => {
        const userRole = data.user?.role?.toUpperCase();
        if (userRole === "ADMIN") {
          window.location.href = "/admin";
        } else if (userRole === "MEMBER") {
          window.location.href = "/member/dashboard";
        } else {
          window.location.href = "/user/dashboard";
        }
      }, 800);
    } catch (err) {
      setErrorMsg("Network error during verification.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("✓ A new 6-digit verification code has been dispatched to your email!");
      } else {
        setErrorMsg(data.message || "Failed to resend OTP.");
      }
    } catch (err) {
      setErrorMsg("Error resending OTP.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-card p-8 rounded-2xl border border-border shadow-xl space-y-6">
      <div className="text-center space-y-2">
        <div className="h-12 w-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto text-2xl">
          🔒
        </div>
        <H1 className="text-2xl font-bold tracking-tight">Verify Email OTP</H1>
        <p className="text-xs text-muted-foreground">
          We sent a 6-digit security code to: <strong className="text-foreground">{email || "your email"}</strong>
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
          <span>⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
          <span>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleVerify} className="space-y-6">
        <div>
          <label className="block text-xs font-bold text-foreground mb-2 text-center">
            Enter 6-Digit Verification Code
          </label>
          <input
            type="text"
            maxLength={6}
            placeholder="849201"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            className="w-full h-14 text-center text-2xl font-extrabold tracking-widest rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading || otp.length < 6}
          className="w-full h-11 rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
        >
          {loading ? "Verifying..." : "Verify & Authenticate Account"}
        </button>
      </form>

      <div className="text-center text-xs text-muted-foreground border-t border-border pt-4 flex items-center justify-between">
        <span>Didn't receive code?</span>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="text-primary font-bold hover:underline disabled:opacity-50"
        >
          {resending ? "Sending..." : "Resend OTP Code"}
        </button>
      </div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-xs text-muted-foreground">Loading Verification...</div>}>
        <VerifyOtpForm />
      </Suspense>
    </div>
  );
}