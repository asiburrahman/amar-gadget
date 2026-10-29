"use client";
import { useEffect, useId, useRef, useState } from "react";
import Form from "next/form";
import { catalogQuerySchema } from "@/lib/validations/catalog-query";
import type { CatalogOption } from "@/lib/catalog-options";

export function HeaderSearch({ mobile = false }: { mobile?: boolean }) {
  const id = useId();
  const [category, setCategory] = useState(""), [choices, setChoices] = useState<CatalogOption[]>([]), [error, setError] = useState(""), [lookupError, setLookupError] = useState(false);
  const active = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { active.current?.abort(); clearTimeout(timer.current); }, []);
  const lookup = async (term: string) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    try {
      const response = await fetch(`/api/catalog/options?${new URLSearchParams({ kind: "category", search: term })}`, { signal: controller.signal });
      const body = await response.json(); if (!response.ok || !body.success) throw new Error();
      if (!controller.signal.aborted) { setChoices(body.items); setLookupError(false); }
    } catch { if (!controller.signal.aborted) setLookupError(true); }
  };
  return <div className="w-full"><Form action="/search" aria-label={mobile ? "Mobile product search" : "Product search"} onSubmit={(event) => {
    const parsed = catalogQuerySchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { event.preventDefault(); setError("Check the search text and category."); } else setError("");
  }} className="flex flex-wrap items-center gap-1 w-full rounded-xl border-2 border-[#fed700] bg-white p-1 text-[#333e48]">
    <input aria-label="Search products" name="q" type="search" maxLength={200} placeholder="Search products" className="min-w-20 flex-1 p-2 text-sm" />
    <input aria-label="Search category (optional)" aria-describedby={`${id}-help`} name="category" type="search" maxLength={120} list={id} value={category} onFocus={() => void lookup(category)} onChange={(event) => { const term = event.target.value; setCategory(term); active.current?.abort(); clearTimeout(timer.current); timer.current = setTimeout(() => void lookup(term), 300); }} placeholder="All categories" className="min-w-20 w-32 p-2 text-xs border-l" />
    <datalist id={id}>{choices.map((choice) => <option key={choice.id} value={choice.slug}>{choice.name}</option>)}</datalist>
    <button type="submit" className="rounded bg-[#fed700] px-3 py-2 text-xs font-bold">Search</button>
  </Form><span id={`${id}-help`} className="sr-only">Optional: choose an exact category name or slug. Type to find more categories.</span>
    {lookupError && <p role="status" className="text-xs">Category suggestions unavailable. <button type="button" onClick={() => void lookup(category)}>Retry categories</button></p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
