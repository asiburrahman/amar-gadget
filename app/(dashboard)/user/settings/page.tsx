import React from "react";
import { Metadata } from "next";
import { ProfileManager } from "@/components/dashboard/profile-manager";

export const metadata: Metadata = {
  title: "Account Settings | Amar Gadget",
  description: "Manage your profile settings, security, and addresses.",
};

export default function UserSettingsPage() {
  return (
    <div className="min-h-screen py-4 md:py-8">
      <ProfileManager initialRole="USER" />
    </div>
  );
}