"use client";
import { useState } from "react";
import type { HomepageBanner } from "@/lib/homepage-banners";
import { ManagedBanner } from "@/components/home/managed-banner";
export function BannerCarousel({ banners }: { banners: HomepageBanner[] }) {
  const [index, setIndex] = useState(0);
  if (!banners.length) return null;
  const selected = Math.min(index, banners.length - 1);
  return <div className="lg:col-span-3 space-y-3 py-6" role="region" aria-roledescription="carousel" aria-label="Featured offers"><div aria-live="polite" aria-atomic="true"><ManagedBanner banner={banners[selected]} hero /></div>{banners.length > 1 && <div className="flex flex-wrap items-center justify-center gap-2"><button className="rounded border p-2" onClick={() => setIndex((selected + banners.length - 1) % banners.length)} aria-label="Previous featured offer">Previous</button><span>{selected + 1} / {banners.length}</span>{banners.map((banner, n) => <button className="rounded border px-3 py-2" key={banner.id} aria-label={`Show featured offer ${n + 1}: ${banner.title}`} aria-current={n === selected ? "true" : undefined} onClick={() => setIndex(n)}>{n + 1}</button>)}<button className="rounded border p-2" onClick={() => setIndex((selected + 1) % banners.length)} aria-label="Next featured offer">Next</button></div>}</div>;
}
