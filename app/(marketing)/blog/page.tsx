import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { H1, P } from "@/components/ui/typography";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Tech News & Reviews | Amar Gadget Blog",
    description: "Read the latest gadget reviews, tech comparisons, buyer guides, and news in Bangladesh.",
  };
}

export default function BlogPage() {
  const articles = [
    {
      id: "iphone-16-pro-review",
      title: "Apple iPhone 16 Pro Max Full Review: Worth the Upgrade?",
      excerpt: "An in-depth look at the A18 Pro benchmark scores, camera control button, and battery longevity in real-world Bangladesh usage.",
      date: "Aug 10, 2026",
      readTime: "5 min read",
      author: "Tech Desk",
      category: "Reviews",
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "macbook-air-m3-buying-guide",
      title: "MacBook Air M3 vs MacBook Pro M3: Which Laptop Should You Buy?",
      excerpt: "Comparing performance, thermal throttling, port selection, and display quality for developers and content creators.",
      date: "Aug 05, 2026",
      readTime: "7 min read",
      author: "Laptops Team",
      category: "Buying Guide",
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "best-noise-canceling-headphones-2026",
      title: "Top 5 Active Noise Canceling Headphones Available in BD",
      excerpt: "Evaluating Sony WH-1000XM5, Bose QuietComfort Ultra, and Sennheiser Momentum 4 on comfort and ANC capability.",
      date: "Jul 28, 2026",
      readTime: "4 min read",
      author: "Audio Lab",
      category: "Audio",
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header Banner */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            Tech Insights & Reviews
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Amar Gadget Tech Blog
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Stay updated with expert device reviews, buying guides, and technical insights.
          </P>
        </div>
      </section>

      {/* Grid */}
      <section className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {articles.map((article) => (
            <article
              key={article.id}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="relative aspect-16/9 w-full overflow-hidden bg-muted">
                  <Image
                    src={article.imageUrl}
                    alt={article.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-background/80 backdrop-blur-sm text-primary">
                    {article.category}
                  </span>
                </div>

                <div className="p-6 pt-0 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{article.date}</span>
                    <span>•</span>
                    <span>{article.readTime}</span>
                  </div>

                  <Link href={`/blog/${article.id}`}>
                    <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                      {article.title}
                    </h3>
                  </Link>

                  <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                    {article.excerpt}
                  </p>
                </div>
              </div>

              <div className="p-6 pt-0 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
                <span>By {article.author}</span>
                <span className="group-hover:translate-x-1 transition-transform">Read Article →</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}