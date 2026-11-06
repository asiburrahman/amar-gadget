"use client";
import { useRef, useState, useEffect, useId, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { campaignFieldsSchema, type CampaignFields } from "@/lib/validations/campaign";
import { saveCampaign, deleteCampaign } from "@/server/actions/admin/campaign-actions";

type Choice = { id: string; name: string };
export type EditableCampaign = { id: string; version: number; title: string; slug: string; description: string; startsAt: string; endsAt: string; isActive: boolean; products: { product: Choice }[] };
export function CampaignEditor({ campaign }: { campaign?: EditableCampaign }) {
  const id = useId(), router = useRouter();
  const [fields, setFields] = useState<CampaignFields>({ title: campaign?.title ?? "", slug: campaign?.slug ?? "", description: campaign?.description ?? "", startsAt: campaign?.startsAt ?? "", endsAt: campaign?.endsAt ?? "", isActive: campaign?.isActive ?? false, productIds: campaign?.products.map((item) => item.product.id) ?? [] });
  const [selected, setSelected] = useState<Choice[]>(campaign?.products.map((item) => item.product) ?? []);
  const [choices, setChoices] = useState<Choice[]>([]), [search, setSearch] = useState(""), [page, setPage] = useState(1), [totalPages, setTotalPages] = useState(0), [applied, setApplied] = useState("");
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [lookupError, setLookupError] = useState(""), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null), retry = useRef({ page: 1, term: "" });
  useEffect(() => { const current = controller; return () => current.current?.abort(); }, []);
  const load = async (nextPage = 1, term = search) => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request; retry.current = { page: nextPage, term }; setLoading(true); setLookupError("");
    try {
      const response = await fetch(`/api/products?${new URLSearchParams({ search: term, filter: "sale", page: String(nextPage), limit: "12" })}`, { signal: request.signal, cache: "no-store" });
      const body = await response.json(); if (!response.ok || !body.success) throw new Error();
      if (!request.signal.aborted) { setChoices(body.products.map((product: Choice) => ({ id: product.id, name: product.name }))); setPage(nextPage); setTotalPages(body.totalPages); setApplied(term); setSearched(true); }
    } catch { if (!request.signal.aborted) setLookupError("Product choices unavailable. Retry the search."); } finally { if (!request.signal.aborted) setLoading(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setError(""); setMessage(""); const parsed = campaignFieldsSchema.safeParse({ ...fields, productIds: selected.map((item) => item.id) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check campaign fields."); return; }
    setBusy(true);
    try { const result = await saveCampaign({ ...(campaign ? { id: campaign.id, version: campaign.version } : {}), fields: parsed.data }); if (!result.success) setError(result.error); else { setMessage("Campaign saved."); router.refresh(); if (!campaign) { setFields({ title: "", slug: "", description: "", startsAt: "", endsAt: "", isActive: false, productIds: [] }); setSelected([]); } } }
    catch { setError("Unable to save campaign. Try again."); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!campaign || busy || !window.confirm("Delete this campaign and its product selection?")) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = await deleteCampaign({ id: campaign.id, version: campaign.version }); if (!result.success) setError(result.error ?? "Unable to delete."); else { setMessage("Campaign deleted."); router.refresh(); } }
    catch { setError("Unable to delete campaign. Try again."); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} aria-label={campaign ? `Edit campaign ${campaign.title}` : "Create campaign"} className="border rounded-xl p-4 space-y-4">
    <h2 className="text-xl font-bold">{campaign ? campaign.title : "Create campaign"}</h2>
    <fieldset disabled={busy} className="space-y-3">
      <div><label htmlFor={`${id}-title`}>Title</label><input id={`${id}-title`} required maxLength={120} value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} className="block border p-2 rounded w-full" /></div>
      <div><label htmlFor={`${id}-slug`}>Slug</label><input id={`${id}-slug`} required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={fields.slug} onChange={(event) => setFields({ ...fields, slug: event.target.value })} className="block border p-2 rounded w-full" /></div>
      <div><label htmlFor={`${id}-description`}>Description</label><textarea id={`${id}-description`} maxLength={1000} value={fields.description} onChange={(event) => setFields({ ...fields, description: event.target.value })} className="block border p-2 rounded w-full" /></div>
      {(["startsAt", "endsAt"] as const).map((key) => <div key={key}><label htmlFor={`${id}-${key}`}>{key === "startsAt" ? "Start (UTC)" : "End (UTC)"}</label><input id={`${id}-${key}`} type="datetime-local" step={1} required value={fields[key] ? fields[key].slice(0, 19) : ""} onChange={(event) => setFields({ ...fields, [key]: event.target.value ? `${event.target.value.length === 16 ? `${event.target.value}:00` : event.target.value}Z` : "" })} className="block border rounded p-2" /></div>)}
      <label className="flex gap-2"><input type="checkbox" checked={fields.isActive} onChange={(event) => setFields({ ...fields, isActive: event.target.checked })} />Enabled within the configured time window</label>
      <p className="text-sm">This campaign lists current catalog discounts. It does not set prices or impose a separate stock quota.</p>
      <fieldset className="border rounded p-3 space-y-3"><legend>Selected products ({selected.length}/50)</legend>
        {selected.map((item, index) => <div key={item.id} className="flex flex-wrap gap-2"><span>{index + 1}. {item.name}</span><button type="button" aria-label={`Remove ${item.name} from campaign`} onClick={() => setSelected(selected.filter((choice) => choice.id !== item.id))}>Remove</button>{index > 0 && <button type="button" aria-label={`Move ${item.name} up`} onClick={() => { const next = [...selected]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setSelected(next); }}>Move up</button>}</div>)}
        <label htmlFor={`${id}-search`}>Find discounted products</label><div className="flex gap-2"><input id={`${id}-search`} maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void load(1, search); } }} className="border rounded p-2" /><button type="button" disabled={loading} onClick={() => void load()}>Find products</button></div>
        {choices.map((item) => <div key={item.id}><button type="button" disabled={selected.some((choice) => choice.id === item.id) || selected.length >= 50} onClick={() => setSelected([...selected, item])}>Add {item.name}</button></div>)}
        <div className="flex gap-3"><button type="button" disabled={loading || page <= 1} onClick={() => void load(page - 1, applied)}>Previous choices</button><button type="button" disabled={loading || page >= totalPages} onClick={() => void load(page + 1, applied)}>Next choices</button></div>
        {loading && <p role="status">Loading products...</p>}{!loading && !lookupError && searched && totalPages === 0 && <p>No products match this search.</p>}
        {lookupError && <p role="alert">{lookupError} <button type="button" onClick={() => void load(retry.current.page, retry.current.term)}>Retry product choices</button></p>}
      </fieldset>
      <button type="submit">{busy ? "Saving..." : "Save campaign"}</button>{campaign && <button type="button" onClick={() => void remove()} className="ml-4">Delete campaign</button>}
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </form>;
}
