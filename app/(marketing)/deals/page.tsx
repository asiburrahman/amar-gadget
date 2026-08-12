import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { H1, P } from "@/components/ui/typography";
import { formatCurrency } from "@/lib/formatter";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Flash Deals & Launch Discounts | Amar Gadget",
    description: "Exclusive limited-time discounts on flagship smartphones, MacBooks, noise-canceling headphones, and gadgets.",
  };
}

export default function DealsPage() {
  const flashDeals = [
    {
      id: "deal-1",
      title: "Apple iPhone 16 Pro Max 256GB",
      originalPrice: 175000,
      dealPrice: 165000,
      discount: "6% OFF",
      soldCount: 42,
      totalCount: 50,
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
      endsIn: "08h : 14m : 22s",
    },
    {
      id: "deal-2",
      title: 'Apple MacBook Air 15" M3 Chip 16GB / 512GB',
      originalPrice: 190000,
      dealPrice: 182000,
      discount: "8% OFF",
      soldCount: 18,
      totalCount: 25,
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
      endsIn: "12h : 45m : 05s",
    },
    {
      id: "deal-3",
      title: "Sony WH-1000XM5 Noise Canceling Headphones",
      originalPrice: 42000,
      dealPrice: 38500,
      discount: "8% OFF",
      soldCount: 35,
      totalCount: 40,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
      endsIn: "04h : 30m : 18s",
    },
    {
      id: "deal-4",
      title: "Samsung Galaxy Watch 6 Classic 47mm LTE",
      originalPrice: 39000,
      dealPrice: 34990,
      discount: "10% OFF",
      soldCount: 29,
      totalCount: 30,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
      endsIn: "02h : 10m : 40s",
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header Banner */}
      <section className="border-b bg-gradient-to-b from-rose-500/10 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-full mb-3">
            <span>🔥</span> Limited Time Offer
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Flash Deals & Mega Discounts
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Grab exclusive launch pricing and limited stock offers with official brand warranty.
          </P>
        </div>
      </section>

      {/* Grid */}
      <section className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {flashDeals.map((deal) => {
            const percentSold = Math.round((deal.soldCount / deal.totalCount) * 100);

            return (
              <div
                key={deal.id}
                className="group overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col sm:flex-row gap-6 items-center"
              >
                <div className="relative aspect-square w-full sm:w-44 shrink-0 overflow-hidden rounded-xl bg-muted/30">
                  <Image
                    src={deal.imageUrl}
                    alt={deal.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <Badge variant="destructive" className="absolute top-2 left-2 text-xs font-extrabold">
                    {deal.discount}
                  </Badge>
                </div>

                <div className="flex-1 space-y-3 w-full">
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    Ends in: <span className="text-primary font-mono">{deal.endsIn}</span>
                  </div>

                  <Link href={`/products/${deal.id}`}>
                    <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors line-clamp-1">
                      {deal.title}
                    </h3>
                  </Link>

                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-extrabold text-foreground tracking-tight">
                      {formatCurrency(deal.dealPrice)}
                    </span>
                    <span className="text-sm text-muted-foreground line-through">
                      {formatCurrency(deal.originalPrice)}
                    </span>
                  </div>

                  {/* Stock Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                      <span>Sold: {deal.soldCount}/{deal.totalCount}</span>
                      <span className="text-rose-500 font-bold">{percentSold}% Claimed</span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-rose-500 to-amber-500 rounded-full"
                        style={{ width: `${percentSold}%` }}
                      />
                    </div>
                  </div>

                  <Link
                    href="/cart"
                    className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                  >
                    Claim Deal Now
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}