"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { FormInput } from "@/components/shared/form-input";
import { H1 } from "@/components/ui/typography";
import { useAuth } from "@/hooks/use-auth";

export default function RegisterPage() {
  const { user } = useAuth();
  const [role, setRole] = useState<"USER" | "MEMBER">("USER");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (user) {
      if (user.role === "ADMIN") window.location.href = "/admin";
      else if (user.role === "MEMBER") window.location.href = "/member/dashboard";
      else window.location.href = "/user/dashboard";
    }
  }, [user]);

  // Real-time password verification rules
  const hasMinLen = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const isPasswordValid = hasMinLen && hasUpper && hasLower && hasNumber && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordValid) {
      setErrorMessage("Please ensure your password meets all 5 security requirements listed below.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, avatar: avatar || undefined, role }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.message || "Registration failed. Please verify your inputs.");
        setIsLoading(false);
        return;
      }

      setSuccessMessage("✓ Registration successful! Sending OTP code to your email...");

      setTimeout(() => {
        window.location.href = `/verify-otp?email=${encodeURIComponent(email.toLowerCase())}`;
      }, 800);
    } catch (err) {
      console.error("Registration submission error:", err);
      setErrorMessage("Network error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-md bg-card p-6 sm:p-8 rounded-2xl border border-border shadow-xl space-y-6">
        
        {/* Brand Logo & Title */}
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex items-center space-x-2 group">
            <div className="h-10 w-10 flex items-center justify-center bg-primary text-primary-foreground rounded-xl font-extrabold text-lg shadow-sm group-hover:scale-105 transition-transform">
              AG
            </div>
            <span className="font-extrabold text-2xl tracking-tight text-foreground">
              Amar Gadget
            </span>
          </Link>
          <H1 className="text-2xl font-bold tracking-tight pt-2">Create Account</H1>
          <p className="text-xs text-muted-foreground">
            Join Bangladesh's premier multi-vendor gadget marketplace.
          </p>
        </div>

        {/* Role Selection Switcher */}
        <div className="grid grid-cols-2 gap-3 p-1 bg-muted rounded-xl">
          <button
            type="button"
            onClick={() => setRole("USER")}
            className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              role === "USER"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🛒 Customer Account
          </button>
          <button
            type="button"
            onClick={() => setRole("MEMBER")}
            className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              role === "MEMBER"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🏪 Vendor / Seller
          </button>
        </div>

        {/* Banners */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
            <span>✓</span>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Registration Form */}
        <form
          action="#"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(e);
          }}
          className="space-y-4 text-xs"
        >
          {/* Avatar Input & Preview */}
          <div className="space-y-2">
            <label className="font-bold text-foreground block">Profile Photo (Upload or URL)</label>
            <div className="flex items-center space-x-3">
              <div className="h-12 w-12 rounded-full bg-muted border border-border overflow-hidden shrink-0 flex items-center justify-center relative">
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg">👤</span>
                )}
              </div>
              
              <div className="flex-1 space-y-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="w-full text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
                />
                <input
                  type="url"
                  placeholder="or paste photo URL"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-input bg-background text-[11px]"
                />
              </div>
            </div>
          </div>

          <FormInput
            label="Full Name *"
            name="name"
            autoComplete="name"
            placeholder="e.g. Asibur Rahman"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <FormInput
            label="Email Address *"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="space-y-2">
            <FormInput
              label="Password *"
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="e.g. Password123!"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {/* Password Validation Requirements */}
            <div className="p-3 bg-muted/40 border border-border rounded-xl space-y-1 text-[11px]">
              <p className="font-bold text-foreground mb-1">Password Requirements:</p>
              <div className={`flex items-center gap-1.5 ${hasMinLen ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                <span>{hasMinLen ? "✓" : "○"}</span>
                <span>At least 8 characters</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasUpper ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                <span>{hasUpper ? "✓" : "○"}</span>
                <span>At least 1 uppercase letter (A-Z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasLower ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                <span>{hasLower ? "✓" : "○"}</span>
                <span>At least 1 lowercase letter (a-z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasNumber ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                <span>{hasNumber ? "✓" : "○"}</span>
                <span>At least 1 number (0-9)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasSpecial ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                <span>{hasSpecial ? "✓" : "○"}</span>
                <span>At least 1 special character (!@#$%^&*)</span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            onClick={(e) => {
              e.preventDefault();
              handleSubmit(e);
            }}
            className="w-full h-11 rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                <span>Creating Account...</span>
              </>
            ) : (
              `Register as ${role === "USER" ? "Customer" : "Seller"}`
            )}
          </button>
        </form>

        {/* Footer Link */}
        <div className="text-center text-xs text-muted-foreground border-t border-border pt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-bold">
            Sign In
          </Link>
        </div>

      </div>
    </div>
  );
}