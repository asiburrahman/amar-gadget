"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { isIncidentId } from "@/lib/error-reference";

const choiceSchema = z.object({ id: z.string().min(1).max(64), name: z.string().min(1), pathLabel: z.string().optional() });
const paginationSchema = z.object({ page: z.number().int().min(1), limit: z.literal(25), total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), totalPages: z.number().int().nonnegative(), q: z.string() });
type Choice = z.infer<typeof choiceSchema>;
type Choices = { items: Choice[]; pagination: z.infer<typeof paginationSchema> };
export function TaxonomyPicker({ kind, value, onChange, savedChoice, required = false, disabled = false, name }: {
  kind: "category" | "brand"; value: string; onChange: (id: string) => void; savedChoice?: Choice; required?: boolean; disabled?: boolean; name?: string;
}) {
  const id = useId(), searchId = useId(), label = kind === "category" ? "Category" : "Brand";
  const [data, setData] = useState<Choices | null>(null), [chosen, setChosen] = useState<Choice | undefined>();
  const [search, setSearch] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const active = useRef<AbortController | null>(null), retry = useRef({ page: 1, q: "" });
  const load = useCallback(async (page: number, q: string) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    retry.current = { page, q }; setLoading(true); setError(""); setReference("");
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/${kind === "category" ? "categories" : "brands"}?${new URLSearchParams({ q, page: String(page) })}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (active.current !== controller) return;
      if (!response.ok || body.success !== true) { if (isIncidentId(body.reference)) setReference(body.reference); throw Error("Choices could not be loaded."); }
      const items = z.array(choiceSchema).max(25).parse(body[kind === "category" ? "categories" : "brands"]), pagination = paginationSchema.parse(body.pagination);
      if (pagination.page !== page || pagination.q !== q.trim()) throw Error("Choice page did not match.");
      setData({ items, pagination });
    } catch {
      if (active.current === controller) setError(`${label} choices are temporarily unavailable. Your selection is retained. Retry to browse options.`);
    } finally { clearTimeout(timeout); if (active.current === controller) setLoading(false); }
  }, [kind, label]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(1, ""); });
    return () => { cancelled = true; const previous = active.current; active.current = null; previous?.abort(); };
  }, [load]);
  const selected = [chosen, savedChoice, ...(data?.items ?? [])].find((choice) => choice?.id === value);
  const retained = value ? selected ?? { id: value, name: `Saved ${kind}: ${value}` } : undefined;
  const choices = retained && !data?.items.some((choice) => choice.id === retained.id) ? [retained, ...(data?.items ?? [])] : data?.items ?? [];
  const page = data?.pagination;
  return <fieldset disabled={disabled} className="space-y-2 rounded border p-3">
    <label htmlFor={id} className="block font-semibold">{label}{required ? " *" : " (optional)"}</label>
    <select id={id} name={name ?? `${kind}Id`} required={required} value={value} className="w-full rounded border bg-background p-2" onChange={(event) => { setChosen(choices.find((choice) => choice.id === event.target.value)); onChange(event.target.value); }}>
      <option value="">{required ? `Select ${kind}` : "No brand"}</option>
      {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.pathLabel ?? choice.name}</option>)}
    </select>
    <label htmlFor={searchId} className="block text-xs">Search {kind === "category" ? "categories" : "brands"}</label>
    <div className="flex gap-2"><input id={searchId} type="search" maxLength={120} value={search} className="min-w-0 w-full rounded border p-2" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void load(1, search); } }} /><button type="button" disabled={loading} onClick={() => void load(1, search)}>Find {kind}</button></div>
    {loading && <p role="status">Loading {kind} choices...</p>}
    {error && <p role="alert">{error} {reference && <span>Reference: {reference}. </span>}<button type="button" disabled={loading} onClick={() => void load(retry.current.page, retry.current.q)}>Retry {kind} choices</button></p>}
    {page && !loading && !error && <p className="text-xs">{page.total} matching choices; page {page.page} of {Math.max(1, page.totalPages)}. Your selection stays available when browsing another page.</p>}
    <div className="flex gap-3 text-xs"><button type="button" disabled={loading || !page || page.page <= 1} onClick={() => void load(page!.page - 1, page!.q)}>Previous {kind} choices</button><button type="button" disabled={loading || !page || page.page >= page.totalPages} onClick={() => void load(page!.page + 1, page!.q)}>Next {kind} choices</button></div>
  </fieldset>;
}
