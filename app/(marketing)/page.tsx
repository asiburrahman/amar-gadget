import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { getCatalogListing, type CatalogProduct } from "@/lib/catalog-listing";
import { getActiveCampaigns } from "@/lib/campaigns";
import { SEOGuard } from "@/components/shared/seo-guard";
import { HeroSection } from "@/components/home/hero-section";
import { PromoBanners } from "@/components/home/promo-banners";
import { SpecialDealSection, type DynamicProductItem } from "@/components/home/special-deal-section";
import { BestSellersSection } from "@/components/home/best-sellers-section";
import { CampaignCard } from "@/components/catalog/campaign-card";
import { BannerAd } from "@/components/home/banner-ad";
import { RecentlyViewed } from "@/components/home/recently-viewed";
import { BrandLogos } from "@/components/home/brand-logos";
import { BottomWidgets } from "@/components/home/bottom-widgets";
import { NewsletterBar } from "@/components/home/newsletter-bar";
import { ElectroFooter } from "@/components/footer/electro-footer";
import { generateOrganizationSchema, generateWebsiteSchema } from "@/lib/seo/schema";
import { serializeJsonLd } from "@/lib/seo/serialize-json-ld";
import { publicProductMedia } from "@/lib/product-media-policy";

export const dynamic = "force-dynamic";
export const metadata = { alternates: { canonical: "/" } };
const card = (product: CatalogProduct): DynamicProductItem => ({ ...product, description: product.description ?? undefined, imageUrl: product.imageUrl ?? undefined, category: product.category.name });
export default async function Home() {
  const [featured, sale, rated, best, campaigns, categories, brands] = await Promise.allSettled([
    prisma.product.findMany({ where: { ...publicProductWhere, isFeatured: true }, take: 12, orderBy: [{ createdAt: "desc" }, { id: "asc" }], include: { category: { select: { name: true } } } }),
    getCatalogListing({ filter: "sale", limit: 12 }), getCatalogListing({ sort: "rating", limit: 12 }), getCatalogListing({ sort: "bestsellers", limit: 8 }),
    getActiveCampaigns(), prisma.category.findMany({ select: { id: true, name: true, slug: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 10 }),
    prisma.brand.findMany({ select: { id: true, name: true, slug: true, _count: { select: { products: { where: publicProductWhere } } } }, take: 12, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  const featuredProducts: DynamicProductItem[] = featured.status === "fulfilled" ? featured.value.map((product) => ({ ...product, ...publicProductMedia(product), description: product.description ?? undefined, price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice), imageUrl: publicProductMedia(product).imageUrl ?? undefined, category: product.category.name })) : [];
  const onSaleProducts = sale.status === "fulfilled" ? sale.value.products.map(card) : [];
  const topRatedProducts = rated.status === "fulfilled" ? rated.value.products.filter((product) => product.reviewCount > 0 && product.rating > 0).map(card) : [];
  const bestSellerProducts = best.status === "fulfilled" ? best.value.products.filter((product) => product.unitsSold && product.unitsSold !== "0").map((product) => ({ ...card(product), unitsSold: product.unitsSold })) : [];
  const preview = campaigns.status === "fulfilled" ? campaigns.value.campaigns[0] : undefined;
  return <SEOGuard><div className="flex-1 flex flex-col bg-white text-slate-900"><main className="flex-1">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(generateOrganizationSchema()) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(generateWebsiteSchema()) }} />
    <HeroSection featuredProduct={featuredProducts[0] ?? onSaleProducts[0] ?? null} categories={categories.status === "fulfilled" ? categories.value : []} />
    <PromoBanners />
    <section aria-label="Current campaigns" className="max-w-7xl mx-auto p-4 py-8 space-y-4"><h2 className="text-xl font-bold">Current campaigns</h2><Link href="/deals" className="underline">Browse all campaigns</Link>
      {campaigns.status === "rejected" ? <p role="alert">Campaigns are temporarily unavailable.</p> : preview ? <CampaignCard campaign={{ ...preview, products: preview.products.slice(0, 4) }} serverNow={campaigns.value.now} /> : <p>No active campaigns with eligible products right now.</p>}
    </section>
    <SpecialDealSection featuredProducts={featuredProducts} onSaleProducts={onSaleProducts} topRatedProducts={topRatedProducts} unavailable={[...(featured.status === "rejected" ? ["featured" as const] : []), ...(sale.status === "rejected" ? ["onsale" as const] : []), ...(rated.status === "rejected" ? ["toprated" as const] : [])]} />
    <BestSellersSection products={bestSellerProducts} unavailable={best.status === "rejected"} />
    <BannerAd /><RecentlyViewed />
    <BrandLogos brands={brands.status === "fulfilled" ? brands.value.map((brand) => ({ id: brand.id, slug: brand.slug, name: brand.name, count: brand._count.products })) : []} unavailable={brands.status === "rejected"} />
    <BottomWidgets featuredProducts={featuredProducts} onSaleProducts={onSaleProducts} topRatedProducts={topRatedProducts} />
    <NewsletterBar />
  </main><ElectroFooter /></div></SEOGuard>;
}
