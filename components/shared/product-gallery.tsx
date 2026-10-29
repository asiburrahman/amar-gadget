"use client";

import { useState } from "react";
import Image from "next/image";
import { productImageNeedsDirectDelivery } from "@/lib/product-media-policy";

export function ProductGallery({ name, imageUrl, images, offer }: { name: string; imageUrl?: string | null; images: string[]; offer?: boolean }) {
  const gallery = [...new Set([imageUrl, ...images].filter((value): value is string => Boolean(value)))];
  const [selected, setSelected] = useState(0);
  const active = gallery[selected] ?? gallery[0];
  return <div className="space-y-3">
    <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-muted/20 border border-border flex items-center justify-center">
      {active ? <Image unoptimized={productImageNeedsDirectDelivery(active)} fill priority sizes="(max-width: 1024px) 100vw, 50vw" src={active} alt={`${name} — image ${selected + 1}`} className="object-contain p-4" /> : <p>No image available</p>}
      {offer && <span className="absolute top-4 left-4 bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">OFFER DEALS</span>}
    </div>
    {gallery.length > 1 && <div role="group" aria-label="Product image gallery" className="flex gap-2 overflow-x-auto">{gallery.map((url, index) => <button key={url} type="button" aria-label={`View image ${index + 1} of ${name}`} aria-pressed={selected === index} onClick={() => setSelected(index)} className="relative w-20 h-20 shrink-0 rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-primary"><Image unoptimized={productImageNeedsDirectDelivery(url)} fill sizes="80px" src={url} alt="" className="object-contain p-1" /></button>)}</div>}
  </div>;
}
