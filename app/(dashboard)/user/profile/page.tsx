import React from "react";
import { Metadata } from "next";
import { ProfileManager } from "@/components/dashboard/profile-manager";

export const metadata: Metadata = {
  title: "User Profile & Account Settings | Amar Gadget",
  description: "Manage your personal profile, email, password, and shipping address.",
};

export default function UserProfilePage() {
  return (
    <div className="min-h-screen py-4 md:py-8">
      <ProfileManager initialRole="USER" />
    </div>
  );
}
