import type { Metadata } from "next";
import { Navbar } from "@/components/navbar/navbar";

export const metadata: Metadata = {
  title: "Amar Gadget | Premium Multi-Vendor Marketplace",
  description: "Browse electronics and gadgets from the Amar Gadget marketplace catalog.",
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}
