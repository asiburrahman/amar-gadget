import Link from "next/link";
import type { HomepageBanner } from "@/lib/homepage-banners";
import { ManagedBanner } from "@/components/home/managed-banner";
export function PromoBanners({ banners = [], unavailable = false }: { banners?: HomepageBanner[]; unavailable?: boolean }) {
  return <section className="border-b bg-white py-10" aria-label="Store promotions"><div className="mx-auto max-w-7xl px-4">{unavailable ? <p role="alert">Promotions are temporarily unavailable.</p> : banners.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{banners.map((banner) => <ManagedBanner key={banner.id} banner={banner} />)}</div> : <div className="grid gap-4 sm:grid-cols-3">{[{ title: "Explore the catalog", href: "/products" }, { title: "Browse current campaigns", href: "/deals" }, { title: "Shop by category", href: "/categories" }].map((item) => <Link className="rounded-xl border bg-slate-50 p-6 font-semibold underline" key={item.href} href={item.href}>{item.title}</Link>)}</div>}</div></section>;
}
