import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Inter } from "next/font/google";
import "@/config/env"; // Enforce environment validation on bootstrap
import "./globals.css";

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

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Amar Gadget | Premium Multi-Vendor Marketplace",
  description: "The leading multi-vendor marketplace for electronics and gadgets in Bangladesh.",
};

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
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}
