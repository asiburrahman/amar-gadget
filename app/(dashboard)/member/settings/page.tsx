import React from "react";
import { Metadata } from "next";
import { ProfileManager } from "@/components/dashboard/profile-manager";

export const metadata: Metadata = {
  title: "Member Settings | Amar Gadget",
  description: "Manage your seller settings, security, and addresses.",
};

export default function MemberSettingsPage() {
  return (
    <div className="min-h-screen py-4 md:py-8">
      <ProfileManager initialRole="MEMBER" />
    </div>
  );
}