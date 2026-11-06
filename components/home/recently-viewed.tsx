"use client";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/shared/product-card";
import { useRecentHistoryStore } from "@/stores/recent-history-store";
import { cleanHistory } from "@/lib/validations/recent-history";
import type { RecentProduct } from "@/lib/recent-products";

export function RecentlyViewed() {
  const entries = useRecentHistoryStore((state) => state.entries), clear = useRecentHistoryStore((state) => state.clear);
  const [result, setResult] = useState<{ key: string; products: RecentProduct[]; error?: string }>({ key: "", products: [] });
  const [attempt, setAttempt] = useState(0), [expanded, setExpanded] = useState(false);
  const key = entries.map((entry) => `${entry.id}:${entry.viewedAt}`).join(",");
  useEffect(() => {
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort(); const request = new AbortController(); controller = request;
      const ids = cleanHistory(entries).map((entry) => entry.id);
      if (!ids.length) { setResult({ key, products: [] }); return; }
      const params = new URLSearchParams(); for (const id of ids) params.append("product", id);
      try { const response = await fetch(`/api/products/recently-viewed?${params}`, { signal: request.signal, cache: "no-store" }); const body = await response.json(); if (!response.ok || !body.success) throw new Error(); if (!request.signal.aborted) setResult({ key, products: body.products }); }
      catch { if (!request.signal.aborted) setResult({ key, products: [], error: "Recently viewed products are temporarily unavailable." }); }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { controller?.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [entries, key, attempt]);
  const loading = entries.length > 0 && result.key !== key;
  return <section aria-label="Recently viewed" className="py-10 border-b"><div className="max-w-7xl mx-auto px-4 space-y-4"><h2 className="text-xl font-bold">Recently viewed</h2><p className="text-sm">Products you opened on this browser in the last 30 days. This history is shared by people using this browser.</p>
    {entries.length > 0 && <button type="button" className="underline" onClick={() => { clear(); setExpanded(false); }}>Clear viewing history</button>}
    {loading ? <p role="status">Loading recently viewed products...</p> : result.error && entries.length ? <p role="alert">{result.error} <button type="button" onClick={() => { setResult({ key: "", products: [] }); setAttempt(attempt + 1); }}>Retry recent products</button></p> : !entries.length || !result.products.length ? <p role="status">No available products in this browser&apos;s viewing history.</p> : <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{(expanded ? result.products : result.products.slice(0, 4)).map((product) => <ProductCard key={product.id} {...product} />)}</div>
      {result.products.length > 4 && <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer recent products" : `Show all ${result.products.length} recent products`}</button>}
    </>}
  </div></section>;
}
