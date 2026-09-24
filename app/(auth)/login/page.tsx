"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { FormInput } from "@/components/shared/form-input";
import { H1 } from "@/components/ui/typography";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.message || "Invalid email address or password.");
        setIsLoading(false);
        return;
      }

      setSuccessMessage("Authentication successful! Redirecting...");

      // Redirect based on user role
      setTimeout(() => {
        const userRole = data.user?.role?.toUpperCase();
        if (userRole === "ADMIN") {
          window.location.href = "/admin";
        } else if (userRole === "MEMBER") {
          window.location.href = "/member/dashboard";
        } else {
          window.location.href = "/user/dashboard";
        }
      }, 500);
    } catch (err) {
      console.error("Login submission error:", err);
      setErrorMessage("Network error occurred. Please check your connection.");
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
          <H1 className="text-2xl font-bold tracking-tight pt-2">Account Login</H1>
          <p className="text-xs text-muted-foreground">
            Sign in to access your orders, wishlist, and dashboard.
          </p>
        </div>

        {/* Real Error / Success Alert Banners */}
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

        {/* Authentic Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center space-x-2 text-muted-foreground cursor-pointer">
              <input type="checkbox" className="rounded border-input text-primary focus:ring-primary" />
              <span>Remember me</span>
            </label>
            <Link href="/forgot-password" className="text-primary hover:underline font-semibold">
              Forgot Password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                <span>Authenticating...</span>
              </>
            ) : (
              "Sign In to Account"
            )}
          </button>
        </form>

        {/* Registration Redirection */}
        <div className="text-center text-xs text-muted-foreground border-t pt-4">
          Don't have an account yet?{" "}
          <Link href="/register" className="text-primary hover:underline font-bold">
            Create an Account
          </Link>
        </div>

      </div>
    </div>
  );
}