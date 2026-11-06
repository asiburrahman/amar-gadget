import React from "react";
import { Metadata } from "next";
import { ProfileManager } from "@/components/dashboard/profile-manager";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Admin Settings | Amar Gadget",
  description: "Platform administrator account settings and security configurations.",
};

export default function AdminSettingsPage() {
  return (
    <div className="min-h-screen py-4 md:py-8">
      <div className="container mx-auto px-4 py-4"><Link href="/admin/settings/support" className="underline">Manage public support contact details</Link></div>
      <div className="container mx-auto px-4 py-4"><Link href="/admin/settings/content" className="underline">Manage public pages and articles</Link></div>
      <ProfileManager initialRole="ADMIN" />
    </div>
  );
}
