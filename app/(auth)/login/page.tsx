"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { FormInput } from "@/components/shared/form-input";
import { H1 } from "@/components/ui/typography";
import { useAuth } from "@/hooks/use-auth";

function EyeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function EyeOffIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

export default function LoginPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  // Clear any leaked query parameters from the address bar immediately
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleSubmit = async (e?: React.FormEvent | React.KeyboardEvent | React.MouseEvent) => {
    if (e && "preventDefault" in e) {
      e.preventDefault();
    }
    if (isLoading) return;
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
        if (data.requiresOtp && data.email) {
          setErrorMessage(data.message || "Your account is not verified yet. Redirecting to OTP verification...");
          setTimeout(() => {
            window.location.href = `/verify-otp?email=${encodeURIComponent(data.email)}`;
          }, 1200);
          return;
        }

        const errorText = data.detail ? `${data.message} (${data.detail})` : (data.message || "Invalid email address or password.");
        setErrorMessage(errorText);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e);
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

        {/* Secure Form Container (Pure AJAX, never appends credentials to URL) */}
        <div className="space-y-4">
          <FormInput
            label="Email Address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            required
          />

          <FormInput
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            rightAction={
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted-foreground hover:text-foreground p-1 transition-colors cursor-pointer"
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            }
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
            type="button"
            disabled={isLoading}
            onClick={() => handleSubmit()}
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
        </div>

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