import React from "react";
import { Metadata } from "next";
import { ProfileManager } from "@/components/dashboard/profile-manager";

export const metadata: Metadata = {
  title: "Member / Seller Profile | Amar Gadget",
  description: "Manage your seller store profile, email verification, and security.",
};

export default function MemberProfilePage() {
  return (
    <div className="min-h-screen py-4 md:py-8">
      <ProfileManager initialRole="MEMBER" />
    </div>
  );
}
