"use client";

import React, { useState } from "react";
import Link from "next/link";
import { FormInput } from "@/components/shared/form-input";
import { H1 } from "@/components/ui/typography";

export default function RegisterPage() {
  const [role, setRole] = useState<"USER" | "MEMBER">("USER");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.message || "Registration failed. Please check inputs.");
        setIsLoading(false);
        return;
      }

      setSuccessMessage("Account created successfully! Redirecting...");

      // Redirect based on selected user role
      setTimeout(() => {
        if (role === "MEMBER") {
          window.location.href = "/member/dashboard";
        } else {
          window.location.href = "/user/dashboard";
        }
      }, 500);
    } catch (err) {
      console.error("Registration submission error:", err);
      setErrorMessage("Network error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card p-8 rounded-2xl border border-border shadow-xl space-y-6">
        
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
            Join Bangladesh's premier multi-vendor gadget ecosystem.
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

        {/* Error / Success Banners */}
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

        {/* Authentic Registration Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormInput
            label="Full Name"
            placeholder="Rahim Uddin"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <FormInput
            label="Email Address"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <FormInput
            label="Password"
            type="password"
            placeholder="Minimum 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            type="submit"
            disabled={isLoading}
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

        {/* Bottom Link */}
        <div className="text-center text-xs text-muted-foreground border-t pt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-bold">
            Sign In
          </Link>
        </div>

      </div>
    </div>
  );
}