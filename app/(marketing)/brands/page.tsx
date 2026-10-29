import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { productImageUrlSchema } from "@/lib/validations/product";
import { productImageNeedsDirectDelivery } from "@/lib/product-media-policy";
import { H1, P } from "@/components/ui/typography";
import { brandCollectionHref } from "@/lib/validations/catalog-brand";
import { paginatedMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  return paginatedMetadata("/brands", "Browse brands", "Browse marketplace brands and their available product collections.", (searchParams ? await searchParams : {}).page);
}

export default async function BrandsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = searchParams ? await searchParams : {};
  const page = query.page === undefined ? 1 : typeof query.page === "string" && /^\d{1,6}$/.test(query.page) ? Number(query.page) : 0;
  const limit = 24;
  let unavailable = false, total = 0;
  let brands: { id: string; name: string; slug: string; logo: string | null; _count: { products: number } }[] = [];
  if (page >= 1) try {
    [brands, total] = await Promise.all([
      prisma.brand.findMany({ select: { id: true, name: true, slug: true, logo: true, _count: { select: { products: { where: publicProductWhere } } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      prisma.brand.count(),
    ]);
  } catch { unavailable = true; console.error("Brand directory is temporarily unavailable."); }
  return <div className="min-h-screen bg-background pb-16">
    <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16"><div className="container mx-auto px-4 text-center max-w-3xl">
      <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">Browse Brands</H1>
      <P className="mt-3 text-muted-foreground">Choose a brand to browse its available marketplace products.</P>
    </div></section>
    <section className="container mx-auto px-4 py-12">
      {unavailable ? <div role="alert"><h2>Brands are temporarily unavailable</h2><p>Please try again shortly.</p><Link href="/brands">Retry brand directory</Link></div>
        : page < 1 ? <div role="alert"><h2>Invalid brand page</h2><Link href="/brands">Back to brands</Link></div>
        : brands.length === 0 ? <div role="status"><h2>{total ? "No brands on this page" : "No brands available yet"}</h2><Link href={total ? "/brands" : "/products"}>{total ? "Back to first page" : "Browse products"}</Link></div>
        : <><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{brands.map((brand) => <Link key={brand.id} href={brandCollectionHref(brand)} className="group rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-lg transition-shadow flex flex-col justify-between">
          <div className="space-y-4">
            <div className="h-12 flex items-center font-black text-lg">{brand.logo && productImageUrlSchema.safeParse(brand.logo).success ? <Image src={brand.logo} unoptimized={productImageNeedsDirectDelivery(brand.logo)} width={120} height={48} alt={`${brand.name} logo`} className="max-h-12 object-contain" /> : brand.name}</div>
            <h2 className="text-xl font-bold group-hover:text-primary">{brand.name}</h2>
          </div>
          <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs font-semibold text-primary"><span>{brand._count.products} {brand._count.products === 1 ? "product" : "products"}</span><span>View collection →</span></div>
        </Link>)}</div>
        <nav aria-label="Brand directory pages" className="mt-8 flex gap-4 items-center justify-center">
          {page > 1 && <Link href={`/brands?page=${page - 1}`}>Previous</Link>}<span>Page {page} of {Math.ceil(total / limit)}</span>{page * limit < total && <Link href={`/brands?page=${page + 1}`}>Next</Link>}
        </nav></>}
    </section>
  </div>;
}
