import Image from "next/image";
import Link from "next/link";
import type { HomepageBanner } from "@/lib/homepage-banners";
import { productImageNeedsDirectDelivery } from "@/lib/product-media-policy";
export function ManagedBanner({ banner, hero = false }: { banner: HomepageBanner; hero?: boolean }) {
  const content = <><div className="relative aspect-video w-full"><Image src={banner.imageUrl} alt={banner.title} fill sizes={hero ? "(min-width: 1024px) 75vw, 100vw" : "(min-width: 1024px) 33vw, 100vw"} loading={hero ? "eager" : "lazy"} fetchPriority={hero ? "high" : undefined} unoptimized={productImageNeedsDirectDelivery(banner.imageUrl)} className="object-contain" /></div><div className="space-y-2 p-5">{hero ? <h1 className="text-3xl font-bold sm:text-4xl">{banner.title}</h1> : <h2 className="text-xl font-bold">{banner.title}</h2>}{banner.subtitle && <p>{banner.subtitle}</p>}{banner.linkUrl && <span className="inline-block font-semibold underline">Explore offer</span>}</div></>;
  return banner.linkUrl ? <Link href={banner.linkUrl} className="block overflow-hidden rounded-xl border bg-white focus-visible:outline-2 focus-visible:outline-offset-4">{content}</Link> : <article className="overflow-hidden rounded-xl border bg-white">{content}</article>;
}
