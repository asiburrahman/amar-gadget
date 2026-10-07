"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
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

export default function RegisterPage() {
  const { user } = useAuth();
  const [role, setRole] = useState<"USER" | "MEMBER">("USER");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
  const isPasswordMatch = password && confirmPassword && password === confirmPassword;
  const isPasswordMismatch = Boolean(confirmPassword && password !== confirmPassword);

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

    if (!isPasswordValid) {
      setErrorMessage("Please ensure your password meets all 5 security requirements listed below.");
      return;
    }

    if (!confirmPassword) {
      setErrorMessage("Please repeat your password to confirm.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Password mismatch: Please ensure both passwords match.");
      return;
    }

    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name, 
          email, 
          password, 
          confirmPassword, 
          avatar: avatar || undefined, 
          role 
        }),
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e);
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

        {/* Secure Registration Container (Pure AJAX, never appends credentials to URL) */}
        <div className="space-y-4 text-xs">
          {/* Avatar Input & Preview */}
          <div className="space-y-2">
            <label className="font-bold text-foreground block">Profile Photo (Upload File)</label>
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
              </div>
            </div>
          </div>

          <FormInput
            label="Full Name *"
            autoComplete="name"
            placeholder="e.g. Asibur Rahman"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            required
          />

          <FormInput
            label="Email Address *"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            required
          />

          <div className="space-y-2">
            <FormInput
              label="Password *"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="e.g. Password123!"
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

            {/* Repeat Password Input */}
            <div className="space-y-1">
              <FormInput
                label="Repeat Password *"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                rightAction={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-muted-foreground hover:text-foreground p-1 transition-colors cursor-pointer"
                    title={showConfirmPassword ? "Hide password" : "Show password"}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                }
                error={isPasswordMismatch ? "Passwords do not match / পাসওয়ার্ড দুটি মিলছে না" : undefined}
                required
              />
              {isPasswordMatch && (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold pt-0.5">
                  <span>✓</span>
                  <span>Passwords match / পাসওয়ার্ড মিলেছে</span>
                </div>
              )}
            </div>

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
            type="button"
            disabled={isLoading}
            onClick={() => handleSubmit()}
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
        </div>

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