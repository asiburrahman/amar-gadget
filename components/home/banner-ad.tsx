import Link from "next/link";
import type { HomepageBanner } from "@/lib/homepage-banners";
import { ManagedBanner } from "@/components/home/managed-banner";
export function BannerAd({ banners = [], unavailable = false }: { banners?: HomepageBanner[]; unavailable?: boolean }) {
  return <section className="bg-white py-6" aria-label="Store announcements"><div className="mx-auto max-w-7xl space-y-4 px-4">{unavailable ? <p role="alert">Store announcements are temporarily unavailable.</p> : banners.length ? banners.map((banner) => <ManagedBanner key={banner.id} banner={banner} />) : <div className="rounded-xl border bg-slate-50 p-6"><h2 className="text-2xl font-bold">Find your next gadget</h2><Link className="mt-3 inline-block font-semibold underline" href="/products">Browse the current catalog</Link></div>}</div></section>;
}
