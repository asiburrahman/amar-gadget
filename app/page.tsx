"use client";

import Link from "next/link";
import { SEOGuard } from "@/components/shared/seo-guard";
import { H1, H2, H3, P, Muted, Code } from "@/components/ui/typography";
import { ProductTypographyCard } from "@/components/shared/product-typography-card";
import { StatNumericCard } from "@/components/dashboard/stat-numeric-card";
import { FormInput } from "@/components/shared/form-input";

export default function Home() {
  const featuredProducts = [
    {
      title: "Apple iPhone 16 Pro Max 256GB - Natural Titanium",
      price: "165,000",
      discountPrice: "175,000",
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
      href: "/products/iphone-16-pro-max",
    },
    {
      title: "Apple MacBook Air 15\" M3 Chip 16GB / 512GB",
      price: "182,000",
      discountPrice: "190,000",
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
      href: "/products/macbook-air-m3",
    },
    {
      title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
      price: "38,500",
      discountPrice: "42,000",
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
      href: "/products/sony-wh-1000xm5",
    },
    {
      title: "Samsung Galaxy Watch 6 Classic 47mm LTE",
      price: "34,990",
      discountPrice: "39,000",
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
      href: "/products/galaxy-watch-6",
    },
  ];

  return (
    <SEOGuard>
      <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
        {/* Navigation Bar */}
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
          <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-xl shadow-md">
                ⚡
              </span>
              <span className="text-xl font-bold tracking-tight font-sans">
                Amar Gadget
              </span>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              <Link href="/products" className="hover:text-primary transition-colors">
                Products
              </Link>
              <Link href="/categories" className="hover:text-primary transition-colors">
                Categories
              </Link>
              <Link href="/deals" className="hover:text-primary transition-colors">
                Hot Deals
              </Link>
              <Link href="/about" className="hover:text-primary transition-colors">
                About Us
              </Link>
            </nav>
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm font-medium hover:text-primary transition-colors px-3 py-2"
              >
                Sign In
              </Link>
              <Link
                href="/cart"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Cart
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1">
          {/* Hero Section */}
          <section className="relative overflow-hidden border-b bg-gradient-to-b from-muted/50 via-background to-background py-20 lg:py-28">
            <div className="container mx-auto px-4 sm:px-6 text-center max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-semibold text-primary backdrop-blur-sm mb-6">
                <span>🔥 Bangladesh's Premier Tech Ecosystem</span>
              </div>

              <H1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
                Next-Gen Gadgets Delivered To Your Doorstep
              </H1>

              <P className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Discover flagship smartphones, high-performance laptops, noise-canceling audio, and smart wearables with official warranty and fast delivery across Bangladesh.
              </P>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/products"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                >
                  Explore Collection
                </Link>
                <Link
                  href="/deals"
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-input bg-background px-6 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  View Limited Deals
                </Link>
              </div>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span>System Status Token:</span>
                <Code className="text-xs">STATUS_OK: 200</Code>
              </div>
            </div>
          </section>

          {/* Real-time Dashboard Stats Section */}
          <section className="py-12 border-b bg-muted/20">
            <div className="container mx-auto px-4 sm:px-6">
              <div className="mb-6 text-center md:text-left">
                <H3 className="text-xl font-bold tracking-tight">Market Overview</H3>
                <Muted>Live store statistics updated in real-time</Muted>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatNumericCard
                  title="Total Gadgets"
                  value="1,420+"
                  change="12.5%"
                  isPositive={true}
                  description="In stock & ready to ship"
                />
                <StatNumericCard
                  title="Happy Customers"
                  value="48.5K"
                  change="8.2%"
                  isPositive={true}
                  description="Verified reviews"
                />
                <StatNumericCard
                  title="Avg Delivery Time"
                  value="24 hrs"
                  change="15.0%"
                  isPositive={true}
                  description="Across major cities"
                />
                <StatNumericCard
                  title="Official Warranty"
                  value="100%"
                  change="0.0%"
                  isPositive={true}
                  description="Genuine brand assurance"
                />
              </div>
            </div>
          </section>

          {/* Featured Gadgets Section */}
          <section className="py-16">
            <div className="container mx-auto px-4 sm:px-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-8 gap-4">
                <div>
                  <H2 className="border-b-0 pb-0 text-3xl font-bold tracking-tight">
                    Trending Gadgets
                  </H2>
                  <Muted>Handpicked flagship gear with exclusive launch pricing</Muted>
                </div>
                <Link
                  href="/products"
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  View All Products &rarr;
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {featuredProducts.map((product) => (
                  <ProductTypographyCard
                    key={product.title}
                    title={product.title}
                    price={product.price}
                    discountPrice={product.discountPrice}
                    imageUrl={product.imageUrl}
                    href={product.href}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Newsletter Signup */}
          <section className="py-16 border-t bg-muted/30">
            <div className="container mx-auto px-4 sm:px-6 max-w-2xl text-center">
              <H3 className="text-2xl font-bold tracking-tight mb-2">
                Stay Ahead of Tech Drops
              </H3>
              <P className="text-sm text-muted-foreground mb-6">
                Subscribe to receive early access to flash sales, exclusive discount coupons, and new device launches.
              </P>
              <form className="flex flex-col sm:flex-row gap-3 items-end" onSubmit={(e) => e.preventDefault()}>
                <FormInput
                  label="Email Address"
                  type="email"
                  placeholder="you@example.com"
                  helperText="We respect your privacy. Unsubscribe anytime."
                  className="flex-1"
                />
                <button
                  type="submit"
                  className="h-10 px-6 rounded-md bg-primary text-primary-foreground font-medium text-sm shadow hover:bg-primary/90 transition-colors w-full sm:w-auto cursor-pointer"
                >
                  Subscribe
                </button>
              </form>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t py-8 bg-background">
          <div className="container mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Amar Gadget Ltd. All rights reserved.</p>
            <div className="flex gap-4">
              <Link href="/privacy-policy" className="hover:underline">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:underline">
                Terms of Service
              </Link>
              <Link href="/contact" className="hover:underline">
                Support
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </SEOGuard>
  );
}
