import type { Metadata } from "next";
import { Navbar } from "@/components/navbar/navbar";
import "@/config/env"; // Enforce environment validation on bootstrap
import "@/styles/globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Amar Gadget | Dashboard",
  description: "Manage your Amar Gadget account",
};

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Navbar className="mb-6" />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </>
  );
}