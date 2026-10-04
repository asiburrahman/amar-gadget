"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";

interface AddressData {
  id?: string;
  fullName?: string;
  phone?: string;
  street?: string;
  city?: string;
  district?: string;
  zipCode?: string | null;
}

interface ProfileUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  avatar: string | null;
  role: string;
  sellerStatus?: string | null;
  isVerified: boolean;
  createdAt: string;
  addresses?: AddressData[];
}

interface ProfileManagerProps {
  initialRole?: "USER" | "MEMBER" | "ADMIN";
}

const BD_DISTRICTS = [
  "Dhaka", "Chattogram", "Sylhet", "Rajshahi", "Khulna", "Barishal", 
  "Rangpur", "Mymensingh", "Gazipur", "Narayanganj", "Cumilla", 
  "Bogura", "Cox's Bazar", "Jessore", "Kushtia", "Pabna", "Tangail"
];

export function ProfileManager({ initialRole }: ProfileManagerProps) {
  const { user: authUser, refreshUser, updateUser, setUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const heroFileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<"profile" | "email" | "password" | "address">("profile");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileUser | null>(null);

  // Profile Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Email Change State
  const [newEmail, setNewEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Address State
  const [addressFullName, setAddressFullName] = useState("");
  const [addressPhone, setAddressPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("Dhaka");
  const [zipCode, setZipCode] = useState("");
  const [isUpdatingAddress, setIsUpdatingAddress] = useState(false);
  const [addressMsg, setAddressMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load user data
  useEffect(() => {
    async function loadProfile() {
      try {
        setLoading(true);
        const res = await fetch("/api/user/profile", { cache: "no-store" });
        const data = await res.json();
        if (data.success && data.user) {
          setProfile(data.user);
          setName(data.user.name || "");
          setPhone(data.user.phone || "");
          setAvatar(data.user.avatar || "");
          setAvatarPreview(data.user.avatar || null);
          setUser(data.user);

          if (data.user.addresses && data.user.addresses.length > 0) {
            const defAddr = data.user.addresses[0];
            setAddressFullName(defAddr.fullName || data.user.name || "");
            setAddressPhone(defAddr.phone || data.user.phone || "");
            setStreet(defAddr.street || "");
            setCity(defAddr.city || "");
            setDistrict(defAddr.district || "Dhaka");
            setZipCode(defAddr.zipCode || "");
          } else {
            setAddressFullName(data.user.name || "");
            setAddressPhone(data.user.phone || "");
          }
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  // Resend OTP countdown
  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  // Compress & resize image to 400x400 for optimal fast upload and DB storage
  const processImageFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_SIZE = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height = Math.round((height * MAX_SIZE) / width);
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(event.target?.result as string);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          // Export as compressed WebP or JPEG
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  // Direct File Selection Handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileMsg({ type: "error", text: "শুধুমাত্র ছবি (JPG, PNG, WebP) ফাইল নির্বাচন করুন।" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileMsg({ type: "error", text: "ছবির সাইজ সর্বোচ্চ ৫ মেগাবাইট (5MB) হতে পারবে।" });
      return;
    }

    try {
      setIsUploadingAvatar(true);
      setProfileMsg(null);

      // Process and optimize image
      const optimizedDataUrl = await processImageFile(file);
      setAvatarFile(file);
      setAvatarPreview(optimizedDataUrl);
      setAvatar(optimizedDataUrl);

      // Directly upload to server
      const res = await fetch("/api/user/upload-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: optimizedDataUrl }),
      });

      const data = await res.json();
      if (data.success) {
        setProfileMsg({ type: "success", text: "প্রোফাইল ছবি সফলভাবে আপলোড হয়েছে! (Photo uploaded successfully)" });
        const updatedUser = { ...(profile || {}), avatar: optimizedDataUrl, name, phone };
        if (profile) {
          setProfile({ ...profile, avatar: optimizedDataUrl });
        }
        updateUser({ avatar: optimizedDataUrl });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", { detail: updatedUser }));
        }
        await refreshUser();
      } else {
        setProfileMsg({ type: "error", text: data.message || "Failed to upload image." });
      }
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err.message || "Error reading image file." });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Remove Photo Handler
  const handleRemovePhoto = async () => {
    try {
      setIsUploadingAvatar(true);
      const res = await fetch("/api/user/upload-avatar", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setAvatar("");
        setAvatarPreview(null);
        setAvatarFile(null);
        const updatedUser = { ...(profile || {}), avatar: null, name, phone };
        if (profile) {
          setProfile({ ...profile, avatar: null });
        }
        updateUser({ avatar: null });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", { detail: updatedUser }));
        }
        setProfileMsg({ type: "success", text: "প্রোফাইল ছবি মুছে ফেলা হয়েছে।" });
        await refreshUser();
      } else {
        setProfileMsg({ type: "error", text: data.message || "Failed to remove photo." });
      }
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err.message || "Error removing photo." });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Handle Profile Update
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    setProfileMsg(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          avatar,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setProfileMsg({ type: "success", text: "প্রোফাইল তথ্য সফলভাবে আপডেট হয়েছে! (Profile updated successfully)" });
        const updatedUser = { ...(profile || {}), name, phone, avatar };
        if (profile) {
          setProfile({ ...profile, name, phone, avatar });
        }
        updateUser({ name, phone, avatar });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", { detail: updatedUser }));
        }
        await refreshUser();
      } else {
        setProfileMsg({ type: "error", text: data.message || "Failed to update profile." });
      }
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err.message || "Something went wrong." });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Handle Request Email Change OTP
  const handleRequestEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newEmail.includes("@")) {
      setEmailMsg({ type: "error", text: "সঠিক নতুন ইমেইল এড্রেস লিখুন। (Please enter a valid new email address)" });
      return;
    }

    setIsSendingOtp(true);
    setEmailMsg(null);

    try {
      const res = await fetch("/api/user/change-email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail }),
      });

      const data = await res.json();
      if (data.success) {
        setIsOtpSent(true);
        setResendTimer(60);
        setEmailMsg({
          type: "success",
          text: `নতুন ইমেইলে (${newEmail}) ৬-সংখ্যার ওটিপি কোড পাঠানো হয়েছে। চেক করে নিচের ঘরে লিখুন।`,
        });
      } else {
        setEmailMsg({ type: "error", text: data.message || "Failed to send OTP code." });
      }
    } catch (err: any) {
      setEmailMsg({ type: "error", text: err.message || "Failed to send OTP code." });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Handle Verify Email Change OTP
  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOtp || emailOtp.length < 4) {
      setEmailMsg({ type: "error", text: "৬-সংখ্যার সঠিক ওটিপি কোড লিখুন। (Please enter the valid OTP)" });
      return;
    }

    setIsVerifyingOtp(true);
    setEmailMsg(null);

    try {
      const res = await fetch("/api/user/change-email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, otp: emailOtp }),
      });

      const data = await res.json();
      if (data.success) {
        setEmailMsg({
          type: "success",
          text: `ইমেইল সফলভাবে পরিবর্তন করা হয়েছে! আপনার বর্তমান ইমেইল: ${newEmail}`,
        });
        if (profile) {
          setProfile({ ...profile, email: newEmail, isVerified: true });
        }
        updateUser({ email: newEmail, isVerified: true });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", {
            detail: { ...(profile || {}), email: newEmail, isVerified: true }
          }));
        }
        setIsOtpSent(false);
        setNewEmail("");
        setEmailOtp("");
        await refreshUser();
      } else {
        setEmailMsg({ type: "error", text: data.message || "Invalid or expired OTP." });
      }
    } catch (err: any) {
      setEmailMsg({ type: "error", text: err.message || "Verification failed." });
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Handle Password Update
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPasswordMsg({ type: "error", text: "নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না!" });
      return;
    }

    setIsUpdatingPassword(true);
    setPasswordMsg(null);

    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setPasswordMsg({ type: "success", text: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে! (Password updated successfully)" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordMsg({ type: "error", text: data.message || "Failed to update password." });
      }
    } catch (err: any) {
      setPasswordMsg({ type: "error", text: err.message || "Something went wrong." });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Handle Address Update
  const handleUpdateAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingAddress(true);
    setAddressMsg(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: {
            fullName: addressFullName,
            phone: addressPhone,
            street,
            city,
            district,
            zipCode,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        setAddressMsg({ type: "success", text: "ঠিকানা সফলভাবে সংরক্ষণ করা হয়েছে! (Address saved successfully)" });
      } else {
        setAddressMsg({ type: "error", text: data.message || "Failed to save address." });
      }
    } catch (err: any) {
      setAddressMsg({ type: "error", text: err.message || "Something went wrong." });
    } finally {
      setIsUpdatingAddress(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[350px] space-y-3">
        <div className="w-10 h-10 border-4 border-[#fed700] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-slate-500 font-semibold tracking-wide">Loading profile details...</p>
      </div>
    );
  }

  const role = profile?.role || initialRole || "USER";

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Hidden file input for hero camera button */}
      <input
        type="file"
        ref={heroFileInputRef}
        onChange={handleFileChange}
        accept="image/png, image/jpeg, image/jpg, image/webp"
        className="hidden"
      />

      {/* 1. Profile Hero Card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden p-6 md:p-8">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
          {/* Avatar with Click-to-Upload overlay */}
          <div className="relative group shrink-0">
            <div
              onClick={() => heroFileInputRef.current?.click()}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-2 border-[#fed700] shadow-md bg-slate-100 flex items-center justify-center relative cursor-pointer group hover:opacity-95 transition"
              title="ছবি পরিবর্তন করতে ক্লিক করুন (Click to upload photo)"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt={name || "User"} className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl sm:text-4xl font-black text-[#333e48]">
                  {(name || profile?.email || "U").charAt(0).toUpperCase()}
                </span>
              )}

              {/* Hover overlay with camera icon */}
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
                <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[10px] font-bold">ছবি আপলোড</span>
              </div>
            </div>

            {/* Quick Upload Action Button under avatar */}
            <button
              type="button"
              onClick={() => heroFileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="absolute -bottom-2 -right-2 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] p-2 rounded-full border-2 border-white shadow-md cursor-pointer transition-transform hover:scale-110"
              title="নতুন ছবি আপলোড করুন"
            >
              {isUploadingAvatar ? (
                <div className="w-3.5 h-3.5 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>

          {/* User Details & Badges */}
          <div className="flex-1 text-center md:text-left space-y-2">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-[#333e48]">
                {name || "User Profile"}
              </h1>
              <span
                className={`text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                  role === "ADMIN"
                    ? "bg-purple-100 text-purple-700 border border-purple-200"
                    : role === "MEMBER"
                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                    : "bg-blue-100 text-blue-700 border border-blue-200"
                }`}
              >
                {role === "ADMIN" ? "👑 Admin" : role === "MEMBER" ? "🏪 Member / Seller" : "👤 Customer"}
              </span>
              {profile?.isVerified && (
                <span className="text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                  ✓ Verified
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 flex items-center justify-center md:justify-start gap-1 font-medium">
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>{profile?.email}</span>
              {profile?.phone && (
                <>
                  <span className="text-slate-300 mx-1">|</span>
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <span>{profile.phone}</span>
                </>
              )}
            </p>

            <p className="text-xs text-slate-400">
              সদস্য হয়েছেন: {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" }) : "N/A"}
            </p>
          </div>

          {/* Quick Dashboard Link */}
          <div className="shrink-0 flex items-center gap-2">
            <Link
              href={role === "ADMIN" ? "/admin" : role === "MEMBER" ? "/member/dashboard" : "/user/dashboard"}
              className="px-4 py-2 text-xs font-bold text-[#333e48] bg-slate-100 hover:bg-[#fed700] rounded-xl transition-all shadow-xs flex items-center gap-1.5"
            >
              <span>ড্যাশবোর্ড ফিরে যান</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* 2. Interactive Navigation Tabs */}
        <div className="mt-8 border-b border-gray-200 flex flex-wrap gap-2 sm:gap-4 text-xs font-bold">
          <button
            onClick={() => setActiveTab("profile")}
            className={`pb-3 px-3 transition-colors relative cursor-pointer flex items-center gap-2 ${
              activeTab === "profile"
                ? "text-black border-b-2 border-[#fed700] font-black"
                : "text-slate-500 hover:text-black"
            }`}
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>প্রোফাইল ও ছবি (Profile & Photo)</span>
          </button>

          <button
            onClick={() => setActiveTab("email")}
            className={`pb-3 px-3 transition-colors relative cursor-pointer flex items-center gap-2 ${
              activeTab === "email"
                ? "text-black border-b-2 border-[#fed700] font-black"
                : "text-slate-500 hover:text-black"
            }`}
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span>ইমেইল পরিবর্তন (Change Email + OTP)</span>
          </button>

          <button
            onClick={() => setActiveTab("password")}
            className={`pb-3 px-3 transition-colors relative cursor-pointer flex items-center gap-2 ${
              activeTab === "password"
                ? "text-black border-b-2 border-[#fed700] font-black"
                : "text-slate-500 hover:text-black"
            }`}
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>পাসওয়ার্ড ও নিরাপত্তা (Security)</span>
          </button>

          <button
            onClick={() => setActiveTab("address")}
            className={`pb-3 px-3 transition-colors relative cursor-pointer flex items-center gap-2 ${
              activeTab === "address"
                ? "text-black border-b-2 border-[#fed700] font-black"
                : "text-slate-500 hover:text-black"
            }`}
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>ঠিকানা ও ডেলিভারি (Address)</span>
          </button>
        </div>
      </div>

      {/* 3. TAB CONTENT */}

      {/* TAB 1: PROFILE INFO & DIRECT IMAGE UPLOAD */}
      {activeTab === "profile" && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-6">
          <div>
            <h2 className="text-lg font-black text-[#333e48]">প্রোফাইল তথ্য ও ছবি (Profile Information & Photo)</h2>
            <p className="text-xs text-slate-500 mt-1">
              আপনার কম্পিউটার বা মোবাইল থেকে সরাসরি পছন্দের ছবি আপলোড করুন এবং তথ্য আপডেট করুন।
            </p>
          </div>

          {profileMsg && (
            <div
              className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                profileMsg.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              <span>{profileMsg.type === "success" ? "✓" : "⚠️"}</span>
              <span>{profileMsg.text}</span>
            </div>
          )}

          {/* DEDICATED DIRECT IMAGE UPLOADER (NO URLS) */}
          <div className="p-5 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-4">
            <span className="text-xs font-bold text-[#333e48] block">
              📸 প্রোফাইল ছবি পরিবর্তন ও আপলোড (Upload Profile Photo)
            </span>

            <div className="flex flex-col sm:flex-row items-center gap-5">
              {/* Image Preview Box */}
              <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-[#fed700] shadow-sm bg-white shrink-0 flex items-center justify-center relative">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-black text-slate-400">
                    {(name || profile?.email || "U").charAt(0).toUpperCase()}
                  </span>
                )}
                {isUploadingAvatar && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>

              {/* Upload Action Zone */}
              <div className="flex-1 space-y-2 text-center sm:text-left">
                {/* Hidden Real File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/png, image/jpeg, image/jpg, image/webp"
                  className="hidden"
                />

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                    className="px-4 py-2.5 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span>{avatarPreview ? "নতুন ছবি নির্বাচন করুন" : "ছবি আপলোড করুন (Choose Photo)"}</span>
                  </button>

                  {avatarPreview && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={isUploadingAvatar}
                      className="px-3.5 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>ছবি মুছে ফেলুন</span>
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 font-medium">
                  সাপোর্টেড ফরম্যাট: JPG, PNG, WEBP (সর্বোচ্চ সাইজ: 5MB)। ফাইল নির্বাচন করলেই স্বয়ংক্রিয়ভাবে আপলোড হয়ে যাবে।
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-6 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">পূর্ণ নাম (Full Name) *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Asibur Rahman"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">মোবাইল নাম্বার (Phone Number)</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +880 1700 000000"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>

              {/* Email (Readonly hint) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">বর্তমান ইমেইল (Current Email)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    disabled
                    value={profile?.email || ""}
                    className="w-full px-4 py-2.5 text-xs text-slate-500 bg-slate-100 border border-gray-200 rounded-xl cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveTab("email")}
                    className="px-3 py-2 bg-slate-100 hover:bg-[#fed700] text-xs font-bold text-[#333e48] rounded-xl whitespace-nowrap transition cursor-pointer"
                  >
                    বদলান
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  ইমেইল পরিবর্তন করতে "ইমেইল পরিবর্তন" ট্যাবে যান (OTP ভেরিফিকেশন প্রযোজ্য)।
                </p>
              </div>

              {/* Role Display */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">একাউন্ট রোল (Account Role)</label>
                <input
                  type="text"
                  disabled
                  value={role}
                  className="w-full px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 border border-gray-200 rounded-xl cursor-not-allowed"
                />
              </div>
            </div>

            {/* Submit button */}
            <div className="flex justify-end pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={isUpdatingProfile}
                className="px-6 py-2.5 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {isUpdatingProfile ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
                    <span>সেভ হচ্ছে...</span>
                  </>
                ) : (
                  <span>তথ্য সেভ করুন (Save Changes)</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: CHANGE EMAIL WITH OTP */}
      {activeTab === "email" && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h2 className="text-lg font-black text-[#333e48] flex items-center gap-2">
              <span>📧 ইমেইল পরিবর্তন ও ওটিপি ভেরিফিকেশন</span>
              <span className="text-[10px] uppercase font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                OTP Required
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              নিরাপত্তার স্বার্থে ইমেইল পরিবর্তন করতে নতুন ইমেইলে পাঠানো ৬-সংখ্যার OTP কোড দিয়ে নিশ্চিত করতে হবে।
            </p>
          </div>

          {emailMsg && (
            <div
              className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                emailMsg.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              <span>{emailMsg.type === "success" ? "✓" : "⚠️"}</span>
              <span>{emailMsg.text}</span>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase">বর্তমান ইমেইল এড্রেস:</span>
              <p className="text-sm font-black text-[#333e48] mt-0.5">{profile?.email}</p>
            </div>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2.5 py-1 rounded-lg">
              ✓ Verified
            </span>
          </div>

          {/* STEP 1: Enter new email & Request OTP */}
          {!isOtpSent ? (
            <form onSubmit={handleRequestEmailOtp} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">নতুন ইমেইল এড্রেস (New Email Address) *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. newemail@domain.com"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
                <p className="text-[11px] text-slate-400">
                  আমরা এই নতুন ইমেইল এড্রেসে একটি ৬-সংখ্যার ওয়ান-টাইম ভেরিফিকেশন কোড পাঠাবো।
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSendingOtp || !newEmail}
                  className="px-6 py-2.5 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSendingOtp ? (
                    <>
                      <div className="w-4 h-4 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
                      <span>ওটিপি পাঠানো হচ্ছে...</span>
                    </>
                  ) : (
                    <span>ওটিপি কোড পাঠান (Send OTP Code)</span>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* STEP 2: Enter OTP & Confirm */
            <form onSubmit={handleVerifyEmailOtp} className="space-y-5 bg-amber-50/50 border border-amber-200 rounded-2xl p-6">
              <div className="space-y-1">
                <span className="text-xs font-bold text-amber-900">ভেরিফিকেশন কোড লিখুন (Enter OTP Code)</span>
                <p className="text-xs text-amber-800">
                  <span className="font-bold">{newEmail}</span> ঠিকানায় পাঠানো ৬-সংখ্যার কোডটি প্রবেশ করান:
                </p>
              </div>

              <div className="space-y-1.5">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="• • • • • •"
                  className="w-full max-w-xs text-center tracking-widest text-lg font-black px-4 py-3 bg-white text-[#333e48] border-2 border-[#fed700] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] shadow-xs"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsOtpSent(false);
                      setEmailOtp("");
                    }}
                    className="text-xs font-bold text-slate-500 hover:text-black underline cursor-pointer"
                  >
                    ইমেইল পরিবর্তন করুন
                  </button>

                  <span className="text-slate-300">|</span>

                  {resendTimer > 0 ? (
                    <span className="text-xs text-slate-400 font-medium">
                      পুনরায় পাঠান ({resendTimer}s)
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRequestEmailOtp}
                      disabled={isSendingOtp}
                      className="text-xs font-bold text-amber-800 hover:underline cursor-pointer"
                    >
                      কোড পুনরায় পাঠান
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isVerifyingOtp || emailOtp.length < 4}
                  className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isVerifyingOtp ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>ভেরিফাই হচ্ছে...</span>
                    </>
                  ) : (
                    <span>ভেরিফাই ও ইমেইল আপডেট করুন (Verify & Update)</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 3: PASSWORD & SECURITY */}
      {activeTab === "password" && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h2 className="text-lg font-black text-[#333e48]">পাসওয়ার্ড পরিবর্তন (Change Password)</h2>
            <p className="text-xs text-slate-500 mt-1">
              আপনার একাউন্টের নিরাপত্তা নিশ্চিত রাখতে নিয়মিত পাসওয়ার্ড আপডেট রাখুন।
            </p>
          </div>

          {passwordMsg && (
            <div
              className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                passwordMsg.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              <span>{passwordMsg.type === "success" ? "✓" : "⚠️"}</span>
              <span>{passwordMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-lg">
            {/* Current Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333e48]">বর্তমান পাসওয়ার্ড (Current Password) *</label>
              <input
                type={showPassword ? "text" : "password"}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
              />
            </div>

            {/* New Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333e48]">নতুন পাসওয়ার্ড (New Password) *</label>
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="কমপক্ষে ৬ অক্ষর (Minimum 6 characters)"
                className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
              />
            </div>

            {/* Confirm New Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333e48]">নতুন পাসওয়ার্ড নিশ্চিত করুন (Confirm New Password) *</label>
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="পুনরায় নতুন পাসওয়ার্ড লিখুন"
                className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
              />
            </div>

            {/* Show Password Toggle */}
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center space-x-2 text-slate-600 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="rounded border-gray-300 text-[#fed700] focus:ring-[#fed700]"
                />
                <span>পাসওয়ার্ড দেখুন (Show Password)</span>
              </label>

              <Link
                href="/forgot-password"
                className="text-xs font-bold text-amber-700 hover:text-black underline"
              >
                পাসওয়ার্ড ভুলে গেছেন?
              </Link>
            </div>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="px-6 py-2.5 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {isUpdatingPassword ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
                    <span>পাসওয়ার্ড আপডেট হচ্ছে...</span>
                  </>
                ) : (
                  <span>পাসওয়ার্ড আপডেট করুন (Update Password)</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: ADDRESS & DELIVERY */}
      {activeTab === "address" && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h2 className="text-lg font-black text-[#333e48]">ডেলিভারি ঠিকানা (Shipping Address)</h2>
            <p className="text-xs text-slate-500 mt-1">
              পণ্য ডেলিভারির জন্য আপনার ডিফল্ট ঠিকানা ও যোগাযোগের তথ্য সংরক্ষণ করুন।
            </p>
          </div>

          {addressMsg && (
            <div
              className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                addressMsg.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              <span>{addressMsg.type === "success" ? "✓" : "⚠️"}</span>
              <span>{addressMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleUpdateAddress} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">প্রাপকের নাম (Recipient Name) *</label>
                <input
                  type="text"
                  required
                  value={addressFullName}
                  onChange={(e) => setAddressFullName(e.target.value)}
                  placeholder="e.g. Asibur Rahman"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">যোগাযোগের মোবাইল (Phone) *</label>
                <input
                  type="text"
                  required
                  value={addressPhone}
                  onChange={(e) => setAddressPhone(e.target.value)}
                  placeholder="e.g. 01700000000"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">রাস্তা / বাসা / এলাকা (Street Address) *</label>
                <input
                  type="text"
                  required
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="e.g. House 12, Road 4, Sector 7, Uttara"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">থানা / শহর (City / Thana) *</label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Uttara / Dhanmondi"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">জেলা (District) *</label>
                <select
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition bg-white"
                >
                  {BD_DISTRICTS.map((dist) => (
                    <option key={dist} value={dist}>
                      {dist}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333e48]">পোস্টাল কোড (Zip / Postal Code)</label>
                <input
                  type="text"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="e.g. 1230"
                  className="w-full px-4 py-2.5 text-xs text-[#333e48] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fed700] transition"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={isUpdatingAddress}
                className="px-6 py-2.5 bg-[#fed700] hover:bg-[#eec800] text-[#333e48] font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {isUpdatingAddress ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#333e48] border-t-transparent rounded-full animate-spin"></div>
                    <span>সংরক্ষণ হচ্ছে...</span>
                  </>
                ) : (
                  <span>ঠিকানা সংরক্ষণ করুন (Save Address)</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
