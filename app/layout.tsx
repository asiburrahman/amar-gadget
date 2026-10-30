import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "@/styles/globals.css";
import { connection } from "next/server";
import { readApplicationOrigin } from "@/config/runtime";
import { WishlistSync } from "@/components/account/wishlist-sync";
import { CartSync } from "@/components/account/cart-sync";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const fontInter = Inter({
  subsets: ["latin"],
  variable: "--font-inter-sans",
  display: "swap",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  // Resolve the deployed origin at request time; a reusable standalone artifact
  // must not bake a build machine's hostname into every page.
  await connection();
  return { metadataBase: new URL(readApplicationOrigin()), title: "Amar Gadget | Multi-Vendor Marketplace", description: "Browse electronics and gadgets from marketplace sellers in Bangladesh." };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontInter.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        <WishlistSync />
        <CartSync />
        {children}
      </body>
    </html>
  );
}

