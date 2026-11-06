"use client";
import { useEffect, useState } from "react";
import type { ActiveCampaign } from "@/lib/campaigns";
import { ProductCard } from "@/components/shared/product-card";

export function CampaignCard({ campaign, serverNow }: { campaign: ActiveCampaign; serverNow: string }) {
  const [now, setNow] = useState(Date.parse(serverNow));
  useEffect(() => { const start = performance.now(); const timer = setInterval(() => setNow(Date.parse(serverNow) + performance.now() - start), 1000); return () => clearInterval(timer); }, [serverNow]);
  const remaining = Math.max(0, Math.ceil((Date.parse(campaign.endsAt) - now) / 1000));
  if (!remaining) return <section aria-label={campaign.title} className="border p-5 rounded-xl"><h2 className="text-xl font-bold">{campaign.title}</h2><p role="status">This campaign has ended. Refresh for current campaigns.</p></section>;
  const days = Math.floor(remaining / 86400), hours = Math.floor(remaining / 3600) % 24, minutes = Math.floor(remaining / 60) % 60, seconds = remaining % 60;
  return <section aria-label={campaign.title} className="border rounded-xl p-5 space-y-4"><h2 className="text-2xl font-bold">{campaign.title}</h2><p>{campaign.description}</p>
    <p>Campaign listing ends <time dateTime={campaign.endsAt}>{campaign.endsAt.replace("T", " ").replace(".000Z", " UTC")}</time></p>
    <p role="timer" aria-label="Time until campaign ends">{days}d {hours}h {minutes}m {seconds}s</p>
    <p className="text-sm text-muted-foreground">Current catalog prices in BDT. Campaign listing expiry does not change a product&apos;s independently configured sale price. Checkout confirms current price and stock.</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{campaign.products.map((product) => <ProductCard key={product.id} {...product} imageUrl={product.imageUrl ?? undefined} />)}</div>
  </section>;
}
