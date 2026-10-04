import React from "react";
import { Metadata } from "next";
import { ProfileManager } from "@/components/dashboard/profile-manager";

export const metadata: Metadata = {
  title: "Admin Profile & Credentials | Amar Gadget",
  description: "Manage admin account profile, secure email verification, and password.",
};

export default function AdminProfilePage() {
  return (
    <div className="min-h-screen py-4 md:py-8">
      <ProfileManager initialRole="ADMIN" />
    </div>
  );
}
