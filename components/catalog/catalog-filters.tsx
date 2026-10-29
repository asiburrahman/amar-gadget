"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Form from "next/form";
import Link from "next/link";
import type { CatalogOption, CatalogOptions } from "@/lib/catalog-options";
import { catalogQuerySchema, type CatalogQuery } from "@/lib/validations/catalog-query";
import { MAX_PRODUCT_PRICE } from "@/lib/catalog-constants";

function Lookup({ kind, initial, choice }: { kind: "brand" | "category"; initial: CatalogOptions; choice?: CatalogOption }) {
  const id = useId(), searchId = useId();
  const [options, setOptions] = useState(initial);
  const [selected, setSelected] = useState(choice);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef({ page: 1, term: "" });
  const active = useRef<{ controller?: AbortController }>({});
  useEffect(() => { const current = active.current; return () => current.controller?.abort(); }, []);
  const label = kind === "brand" ? "Brand" : "Category";
  const load = async (page: number, term = applied) => {
    retry.current = { page, term };
    active.current.controller?.abort(); const controller = new AbortController(); active.current.controller = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/catalog/options?${new URLSearchParams({ kind, search: term, page: String(page) })}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Unable to load options.");
      if (!controller.signal.aborted) { setOptions(body); setApplied(term); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load options."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const available = selected && !options.items.some((item) => item.id === selected.id) ? [selected, ...options.items] : options.items;
  return <fieldset className="space-y-2 border rounded-lg p-3">
    <label htmlFor={id} className="block font-semibold">{label}</label>
    <select id={id} name={`${kind}Id`} value={selected?.id ?? ""} onChange={(event) => setSelected(available.find((item) => item.id === event.target.value))} className="w-full border rounded p-2 bg-background">
      <option value="">All {kind === "brand" ? "brands" : "categories"}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <label htmlFor={searchId} className="block text-xs">Search {kind === "brand" ? "brands" : "categories"}</label>
    <div className="flex gap-2"><input id={searchId} type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void load(1, search); } }} className="min-w-0 w-full border rounded p-2" /><button type="button" disabled={loading} onClick={() => void load(1, search)}>Find</button></div>
    {loading && <p role="status">Loading {kind} options...</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void load(retry.current.page, retry.current.term)}>Retry {kind} options</button></p>}
    {!loading && !error && <p className="text-xs">{options.total} options{options.total ? `, page ${options.page} of ${options.totalPages}` : " match this search"}.</p>}
    <div className="flex gap-3 text-xs">
      <button type="button" aria-label={`Previous ${kind} options`} disabled={loading || options.page <= 1} onClick={() => void load(options.page - 1)}>Previous options</button>
      <button type="button" aria-label={`Next ${kind} options`} disabled={loading || options.page >= options.totalPages} onClick={() => void load(options.page + 1)}>Next options</button>
    </div>
  </fieldset>;
}

export function CatalogFilters({ query, brands, categories, brand, category }: { query: CatalogQuery; brands: CatalogOptions; categories: CatalogOptions; brand?: CatalogOption; category?: CatalogOption }) {
  const [error, setError] = useState("");
  const validate = (event: FormEvent<HTMLFormElement>) => {
    const parsed = catalogQuerySchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { event.preventDefault(); setError(parsed.error.issues[0]?.message ?? "Check the filters."); } else setError("");
  };
  return <Form action="/products" onSubmit={validate} aria-label="Product filters" className="space-y-4 border border-border rounded-xl p-4 bg-card">
    <div><label htmlFor="catalog-search" className="block font-semibold">Search products</label><input id="catalog-search" type="search" name="search" maxLength={200} defaultValue={query.search ?? ""} className="w-full border rounded p-2" /></div>
    <div className="grid sm:grid-cols-2 gap-4"><Lookup kind="category" initial={categories} choice={category} /><Lookup kind="brand" initial={brands} choice={brand} /></div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div><label htmlFor="catalog-min-price" className="block font-semibold">Minimum price (BDT)</label><input id="catalog-min-price" name="minPrice" type="number" min={0} max={MAX_PRODUCT_PRICE} step="0.01" defaultValue={query.minPrice ?? ""} className="w-full border rounded p-2" /></div>
      <div><label htmlFor="catalog-max-price" className="block font-semibold">Maximum price (BDT)</label><input id="catalog-max-price" name="maxPrice" type="number" min={0} max={MAX_PRODUCT_PRICE} step="0.01" defaultValue={query.maxPrice ?? ""} className="w-full border rounded p-2" /></div>
      <div><label htmlFor="catalog-sort" className="block font-semibold">Sort products</label><select id="catalog-sort" name="sort" defaultValue={query.sort} className="w-full border rounded p-2 bg-background"><option value="latest">Newest first</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option><option value="rating">Highest rated</option><option value="bestsellers">Best sellers</option></select></div>
      <div><label htmlFor="catalog-page-size" className="block font-semibold">Products per page</label><select id="catalog-page-size" name="limit" defaultValue={query.limit} className="w-full border rounded p-2 bg-background">{[...new Set([12, 24, 48, query.limit])].sort((a, b) => a - b).map((limit) => <option key={limit} value={limit}>{limit}</option>)}</select></div>
    </div>
    <label className="flex items-center gap-2"><input name="filter" type="checkbox" value="sale" defaultChecked={query.filter === "sale"} />On sale only</label>
    <p className="text-xs text-muted-foreground">Prices use the current sale price when present. Best sellers rank units in paid, delivered orders; ties use newest products first.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-4 items-center"><button type="submit" className="px-4 py-2 rounded bg-primary text-primary-foreground">Apply filters</button><Link href="/products" className="underline">Clear all filters</Link></div>
  </Form>;
}
