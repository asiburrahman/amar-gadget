"use client";
import { useState } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/shared/product-card";
export interface DynamicProductItem { id: string; slug?: string; name: string; description?: string; price: number; discountPrice?: number | null; stock: number; imageUrl?: string; category?: string; rating?: number }
type Tab = "featured" | "onsale" | "toprated";
export function SpecialDealSection({ featuredProducts = [], onSaleProducts = [], topRatedProducts = [], unavailable = [] }: { featuredProducts?: DynamicProductItem[]; onSaleProducts?: DynamicProductItem[]; topRatedProducts?: DynamicProductItem[]; unavailable?: Tab[] }) {
  const [tab, setTab] = useState<Tab>("featured"), [expanded, setExpanded] = useState(false);
  const data = { featured: featuredProducts, onsale: onSaleProducts, toprated: topRatedProducts };
  const labels = { featured: "Featured", onsale: "On sale", toprated: "Top rated" };
  return <section aria-label="Catalog highlights" className="py-10 border-b"><div className="max-w-7xl mx-auto px-4 space-y-4"><h2 className="text-xl font-bold">Catalog highlights</h2>
    <div role="group" aria-label="Product highlights" className="flex gap-4">{(["featured", "onsale", "toprated"] as const).map((key) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => { setTab(key); setExpanded(false); }} className="border rounded px-3 py-2">{labels[key]}</button>)}</div>
    <div aria-label={`${labels[tab]} products`}>
      {unavailable.includes(tab) ? <p role="alert">This product collection is temporarily unavailable. <Link href="/products">Browse products</Link></p> : !data[tab].length ? <p>No {labels[tab].toLowerCase()} products currently available.</p> : <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{(expanded ? data[tab] : data[tab].slice(0, 4)).map((product) => <ProductCard key={product.id} {...product} />)}</div>}
    </div>
    {data[tab].length > 4 && <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer products" : `Show all ${data[tab].length} highlighted products`}</button>}
  </div></section>;
}
