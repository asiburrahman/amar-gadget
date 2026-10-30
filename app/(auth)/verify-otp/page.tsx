"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { H1 } from "@/components/ui/typography";
import { useAuthStore, type AuthUser } from "@/stores/auth-store";
import { registrationAvatar, clearRegistrationAvatar } from "@/stores/registration-avatar-store";
import { checkedAvatar, uploadAvatarFile } from "@/lib/client/avatar-client";

function VerifyOtpForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [verifiedUser, setVerifiedUser] = useState<AuthUser | null>(null);
  const [navigating, setNavigating] = useState(false);
  const busy = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(redirectTimer.current), []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const goToAccount = (user: AuthUser) => {
    clearTimeout(redirectTimer.current); setNavigating(true);
    clearRegistrationAvatar(email);
    const path = user.role === "ADMIN" ? "/admin" : user.role === "MEMBER" ? "/member/dashboard" : "/user/dashboard";
    redirectTimer.current = setTimeout(() => router.replace(path), 800);
  };
  const saveSignupPhoto = async (user: AuthUser, reload = false) => {
    const file = registrationAvatar(email);
    if (!file) { goToAccount(user); return; }
    if (user.email.trim().toLowerCase() !== email.trim().toLowerCase() || useAuthStore.getState().user?.id !== user.id) throw new Error("Your account changed. Upload the photo from your profile after signing in.");
    let version = user.avatarVersion ?? 0;
    if (reload) {
      const response = await fetch("/api/user/upload-avatar", { headers: { "X-Avatar-Owner": user.id }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to reload your saved photo.");
      version = checkedAvatar(data.photo, user.id).avatarVersion;
    }
    const photo = await uploadAvatarFile(user.id, version, file);
    if (useAuthStore.getState().user?.id !== user.id) throw new Error("Your account changed. Check your saved photo after signing in.");
    useAuthStore.getState().updateUser({ avatar: photo.avatar, avatarVersion: photo.avatarVersion });
    setSuccessMsg("Email verified and profile photo saved. Redirecting...");
    goToAccount(user);
  };
  const retryPhoto = async () => {
    if (!verifiedUser || busy.current) return;
    busy.current = true; setLoading(true); setErrorMsg("");
    try { await saveSignupPhoto(verifiedUser, true); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : "Photo was not confirmed. Retry or continue to your account."); }
    finally { busy.current = false; setLoading(false); }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || loading) return;
    if (!otp || otp.length !== 6 || !password) {
      setErrorMsg("Enter the six-digit signup code and the password you used for registration.");
      return;
    }

    busy.current = true;
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.message || "Invalid OTP code. Please check your email.");
        setLoading(false);
        return;
      }

      setSuccessMsg("✓ Email verified successfully! Redirecting to your dashboard...");
      setPassword("");
      useAuthStore.getState().setUser(data.user);
      setVerifiedUser(data.user);
      try { await saveSignupPhoto(data.user); }
      catch (error) { setSuccessMsg("Your email is verified. Your selected photo has not been confirmed."); setErrorMsg(error instanceof Error ? error.message : "Retry your photo or continue to your account."); }
      setLoading(false);
    } catch {
      setErrorMsg("Network error during verification.");
      setLoading(false);
    } finally {
      busy.current = false;
    }
  };

  const handleResend = async () => {
    if (!email || busy.current || loading || cooldown) return;
    busy.current = true;
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
      if (res.ok && data.success) {
        setSuccessMsg(data.message || "If this account needs verification, a signup code has been sent.");
        setCooldown(60);
      } else {
        if (res.status === 429) setCooldown(Math.min(600, Math.max(1, Number(res.headers.get("Retry-After")) || 60)));
        setErrorMsg(data.message || "Failed to resend OTP.");
      }
    } catch {
      setErrorMsg("Error resending OTP.");
    } finally {
      busy.current = false;
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

      {verifiedUser ? <div className="space-y-3">
        <p>Your account is verified. You can also upload a photo from your profile.</p>
        <button type="button" disabled={loading || navigating} onClick={() => void retryPhoto()} className="block underline disabled:opacity-50">Retry selected photo</button>
        <button type="button" disabled={loading || navigating} onClick={() => goToAccount(verifiedUser)} className="block underline disabled:opacity-50">Continue to my account</button>
      </div> : <form onSubmit={handleVerify} className="space-y-6">
        <div>
          <label htmlFor="signup-code" className="block text-xs font-bold text-foreground mb-2 text-center">
            Enter 6-Digit Verification Code
          </label>
          <input
            id="signup-code"
            type="text"
            maxLength={6}
            placeholder="Six-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            className="w-full h-14 text-center text-2xl font-extrabold tracking-widest rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none"
            required
          />
        </div>

        <div>
          <label htmlFor="signup-password" className="block text-xs font-bold mb-2">Registration password</label>
          <input id="signup-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-input bg-background p-3" />
          <p className="mt-2 text-xs text-muted-foreground">Use the password you chose when signing up. If it no longer works, reset your password.</p>
          <Link href="/forgot-password" className="text-xs underline">Reset password</Link>
        </div>

        <button
          type="submit"
          disabled={loading || resending || otp.length !== 6 || !password}
          className="w-full h-11 rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
        >
          {loading ? "Verifying..." : "Verify & Authenticate Account"}
        </button>
      </form>}
      <Link href="/login" className="block text-xs underline">Already verified? Sign in</Link>

      <div className="text-center text-xs text-muted-foreground border-t border-border pt-4 flex items-center justify-between">
        <span>Didn&apos;t receive code?</span>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || loading || cooldown > 0 || !!verifiedUser}
          className="text-primary font-bold hover:underline disabled:opacity-50"
        >
          {resending ? "Sending..." : cooldown ? `Resend after ${cooldown}s` : "Resend OTP Code"}
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
