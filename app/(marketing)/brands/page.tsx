import { Metadata } from "next";
import Link from "next/link";
import { H1, P } from "@/components/ui/typography";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Official Brands | Amar Gadget",
    description: "Shop 100% genuine products from Apple, Samsung, Sony, Keychron, Anker, Logitech, and top global tech brands.",
  };
}

export default function BrandsPage() {
  const brands = [
    { name: "Apple", logo: "", count: "120+ Products", description: "iPhone, MacBook, iPad, Apple Watch & AirPods", tag: "Official Partner" },
    { name: "Samsung", logo: "SAMSUNG", count: "95+ Products", description: "Galaxy S-Series, Z Fold, Galaxy Tab & Watch", tag: "Official Warranty" },
    { name: "Sony", logo: "SONY", count: "45+ Products", description: "WH-1000XM5 headphones, Alpha cameras & audio", tag: "Authorized Retailer" },
    { name: "Keychron", logo: "KEYCHRON", count: "30+ Products", description: "Custom mechanical keyboards & accessories", tag: "Exclusive" },
    { name: "Logitech", logo: "logi", count: "50+ Products", description: "MX Master mice, MX Keys & gaming peripherals", tag: "Authorized Retailer" },
    { name: "Anker", logo: "ANKER", count: "75+ Products", description: "GaN chargers, PowerCore banks & Soundcore audio", tag: "Official Warranty" },
    { name: "OnePlus", logo: "ONEPLUS", count: "40+ Products", description: "Flagship smartphones & Nord ecosystem", tag: "Official Partner" },
    { name: "Xiaomi", logo: "mi", count: "110+ Products", description: "POCO, Redmi, smart TVs & lifestyle gadgets", tag: "Authorized Retailer" },
    { name: "Asus ROG", logo: "ROG", count: "25+ Products", description: "ROG Zephyrus, Strix laptops & gaming accessories", tag: "Official Partner" },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header Banner */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            100% Genuine Brand Warranty
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Official Brand Partners
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Explore gadgets directly from world-class tech manufacturers with official brand warranty in Bangladesh.
          </P>
        </div>
      </section>

      {/* Grid */}
      <section className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {brands.map((brand) => (
            <Link
              key={brand.name}
              href={`/products?brand=${brand.name.toLowerCase()}`}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="h-12 px-4 rounded-xl bg-muted/60 border border-border flex items-center justify-center font-black text-lg text-foreground group-hover:scale-105 transition-transform">
                    {brand.logo}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    {brand.tag}
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors">
                    {brand.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {brand.description}
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
                <span>{brand.count}</span>
                <span className="group-hover:translate-x-1 transition-transform">View Collection →</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}