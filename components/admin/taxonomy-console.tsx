"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { useTaxonomyConsole, type TaxonomyResult } from "@/hooks/use-taxonomy-console";
import { uploadProductImage } from "@/lib/client/product-image-upload";
import { isPublicProductImageUrl, productImageNeedsDirectDelivery, validateProductImage } from "@/lib/product-media-policy";
import type { TaxonomyMutation } from "@/lib/validations/taxonomy";
import type { TaxonomyView } from "@/lib/catalog-taxonomy";
type Row = TaxonomyView["rows"][number];
type Draft = { id?: string; version: number; savedName: string; name: string; slug: string; parentId: string | null; parentName: string; image: string | null };
const blank = (): Draft => ({ version: 1, savedName: "New catalog record", name: "", slug: "", parentId: null, parentName: "", image: null });
const fromRow = (row: Row): Draft => ({ id: row.id, version: row.version, savedName: row.name, name: row.name, slug: row.slug, parentId: row.parentId, parentName: row.path.slice(0, -1).join(" / "), image: row.image });
const input = "block w-full rounded border bg-background p-2", button = "rounded border px-3 py-2 disabled:opacity-50";
export function TaxonomyConsole({ ownerId, kind }: { ownerId: string; kind: "category" | "brand" }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading administrator account...</p>;
  if (!user || user.id !== ownerId || user.role !== "ADMIN") return <p>Reload this catalog area with the matching administrator account.</p>;
  return <OwnedConsole key={`${ownerId}:${kind}`} ownerId={ownerId} kind={kind} />;
}
function OwnedConsole({ ownerId, kind }: { ownerId: string; kind: "category" | "brand" }) {
  const api = useTaxonomyConsole(ownerId, kind), [search, setSearch] = useState(""), [draft, setDraft] = useState<Draft>(blank), [formError, setFormError] = useState("");
  const [file, setFile] = useState<File | null>(null), [progress, setProgress] = useState(0), [uploading, setUploading] = useState(false), [recordBusy, setRecordBusy] = useState(false), [deleteVersion, setDeleteVersion] = useState<number | null>(null), [historyId, setHistoryId] = useState<string | null>(null);
  const upload = useRef<AbortController | null>(null), active = useRef(true), opening = useRef(0), uploadBusy = useRef(false);
  useEffect(() => { active.current = true; const cancel = () => { active.current = false; opening.current++; upload.current?.abort(); }; return cancel; }, []);
  const current = () => active.current && useAuthStore.getState().user?.id === ownerId && useAuthStore.getState().user?.role === "ADMIN";
  const disabled = api.busy || api.needsReload || !!api.pending || uploading || recordBusy;
  const select = (row: Row, invalidate = true) => { if (invalidate) opening.current++; setRecordBusy(false); setDraft(fromRow(row)); setFile(null); setProgress(0); setDeleteVersion(null); setFormError(""); };
  const confirmed = async (result: TaxonomyResult | null) => {
    if (!result || !current()) return;
    if (result.deleted) { opening.current++; setRecordBusy(false); setDraft(blank()); setFile(null); setDeleteVersion(null); return; }
    const ticket = ++opening.current; setRecordBusy(true);
    try { const saved = await api.read({ mode: "record", id: result.id }); if (current() && ticket === opening.current) { if (!saved.rows[0]) throw new Error("The saved catalog record is no longer present. Reload the list."); select(saved.rows[0], false); } }
    catch (error) { if (current() && ticket === opening.current) setFormError(error instanceof Error ? error.message : "Unable to reload the saved record."); }
    finally { if (current() && ticket === opening.current) setRecordBusy(false); }
  };
  const perform = async (body: TaxonomyMutation) => { setFormError(""); await confirmed(await api.mutate(body)); };
  const saveImage = async () => {
    if (!file || !draft.id || disabled || uploadBusy.current) return;
    uploadBusy.current = true; const controller = new AbortController(); upload.current = controller; setUploading(true); setFormError("");
    try {
      const saved = await uploadProductImage(file, controller.signal, (value) => { if (current()) setProgress(value); });
      if (current() && !controller.signal.aborted) await perform({ action: "image", kind, id: draft.id, version: draft.version, requestId: crypto.randomUUID(), uploadKey: saved.fileKey });
    } catch (error) { if (current()) setFormError(error instanceof Error ? error.message : "Image upload was not confirmed."); }
    finally { uploadBusy.current = false; if (current()) setUploading(false); }
  };
  return <section aria-label={`${kind} management`} className="space-y-6">
    <p>Changes use saved revisions. Category URLs continue to resolve after a slug rename. Products and subcategories protect a referenced record from deletion.</p>
    <div className="flex flex-wrap gap-3"><button className={button} disabled={api.busy || uploading} onClick={async () => { await confirmed(await api.load()); }} type="button">Reload saved catalog</button><button type="button" className={button} disabled={disabled} onClick={() => { opening.current++; setDraft(blank()); setFile(null); setDeleteVersion(null); setFormError(""); }}>New {kind}</button></div>
    {api.busy && <p role="status">Loading or saving catalog records...</p>}{api.message && <p role="status">{api.message}</p>}{(api.error || formError) && <p role="alert" className="text-destructive">{api.error || formError}</p>}
    {api.needsReload && <p>Reload before another write. Your typed fields and original request are retained.</p>}
    {api.pending && <div className="space-y-2 rounded border p-3"><p>The original write is uncertain. Reload to find its receipt before retrying or discarding it.</p><button type="button" className={button} disabled={!api.canRetry || uploading} onClick={async () => { await confirmed(await api.retry()); }}>Retry original change</button><button type="button" className={button} disabled={api.busy || !api.readConfirmed || api.needsReload || uploading} onClick={api.discard}>Discard unrecorded intent</button></div>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); api.setPage(1); api.setQuery(search.trim()); }}><label>Search catalog<input aria-label="Search catalog" maxLength={80} className={input} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /></label><button disabled={disabled} className={button}>Search</button></form>
    {api.data && <><p>{api.data.total} matching {kind} records</p>{!api.data.rows.length && <p>No records match this catalog view.</p>}<ul className="divide-y">{api.data.rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{row.path.join(" / ")}</p><p className="break-all text-sm">{row.slug} · Revision {row.version}</p><p className="text-sm">{row.productsCount} direct products{kind === "category" ? ` · ${row.childrenCount} direct subcategories` : ""}</p></div><div className="flex gap-2"><button type="button" className={button} disabled={disabled} onClick={() => select(row)}>Edit {row.name}</button><button type="button" className={button} disabled={api.busy || uploading} onClick={() => setHistoryId(row.id)}>History for {row.name}</button></div></li>)}</ul><nav aria-label="Catalog pages" className="flex items-center gap-3"><button type="button" className={button} disabled={disabled || api.page <= 1} onClick={() => api.setPage(api.page - 1)}>Previous records</button><span>Page {api.data.page} of {api.data.totalPages}</span><button type="button" className={button} disabled={disabled || api.page >= api.data.totalPages} onClick={() => api.setPage(api.page + 1)}>Next records</button></nav></>}
    <form className="space-y-3 rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); const fields = { name: draft.name, slug: draft.slug, parentId: kind === "category" ? draft.parentId : null }; void perform(draft.id ? { action: "update", kind, id: draft.id, version: draft.version, requestId: crypto.randomUUID(), fields } : { action: "create", kind, requestId: crypto.randomUUID(), fields }); }}>
      <h2 className="text-xl font-semibold">{draft.id ? `Edit ${draft.savedName}` : `Create ${kind}`}</h2>
      <label>Name<input aria-label="Catalog name" required maxLength={100} className={input} value={draft.name} disabled={disabled} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>URL slug<input aria-label="Catalog URL slug" required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={input} value={draft.slug} disabled={disabled} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label><p className="text-sm">Use lowercase letters, digits and single hyphens. Earlier slugs stay reserved for the same record.</p>
      {kind === "category" && <ParentPicker key={`${draft.id || "new"}:${draft.version}`} id={draft.id} selected={draft.parentId} selectedLabel={draft.parentName} disabled={disabled} read={api.read} onChange={(id, name) => setDraft({ ...draft, parentId: id, parentName: name })} />}
      <button disabled={disabled} className={button}>Save {kind} details</button>
      {draft.id && <button type="button" className={button} disabled={disabled} onClick={() => void confirmed({ kind, id: draft.id!, version: draft.version, deleted: false })}>Discard typed details and load current record</button>}
    </form>
    <section aria-label="Catalog image" className="space-y-3 rounded-xl border p-4"><h2 className="text-xl font-semibold">{kind === "brand" ? "Brand logo" : "Category image"}</h2>
      {draft.image && isPublicProductImageUrl(draft.image) ? <Image src={draft.image} alt={`${draft.savedName} image`} width={160} height={120} unoptimized={productImageNeedsDirectDelivery(draft.image)} className="h-30 w-40 object-contain" /> : <p>No published image is selected.</p>}
      {!draft.id ? <p>Create the catalog record first, then publish its image.</p> : <><label>Image file<input key={`${draft.id}:${draft.version}`} aria-label="Catalog image file" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { const next = event.target.files?.[0] ?? null, error = next ? validateProductImage(next) : null; setFormError(error || ""); setFile(error ? null : next); setProgress(0); }} className={input} /></label><p className="text-sm">JPEG, PNG or WebP up to 5 MiB. The server verifies actual stored bytes before publication.</p><button className={button} disabled={disabled || !file} type="button" onClick={() => void saveImage()}>Upload and publish image</button>{uploading && <p role="status">Image upload: {progress}%</p>}{draft.image && <button className={button} disabled={disabled} type="button" onClick={() => void perform({ action: "image", kind, id: draft.id!, version: draft.version, requestId: crypto.randomUUID(), uploadKey: null })}>Remove published image</button>}</>}
    </section>
    {draft.id && <section className="space-y-2 rounded border p-4"><h2 className="font-semibold">Delete {draft.savedName}</h2><p>Referenced products or subcategories prevent deletion. Financial and catalog audit evidence remains retained.</p><label><input type="checkbox" disabled={disabled} checked={deleteVersion === draft.version} onChange={(event) => setDeleteVersion(event.target.checked ? draft.version : null)} />I intend to delete this saved {kind} record at revision {draft.version}.</label><button type="button" className={button} disabled={disabled || deleteVersion !== draft.version} onClick={() => void perform({ action: "delete", kind, id: draft.id!, version: draft.version, requestId: crypto.randomUUID() })}>Delete selected {kind}</button></section>}
    {historyId && <History key={historyId} id={historyId} read={api.read} />}
  </section>;
}
type Reader = ReturnType<typeof useTaxonomyConsole>["read"];
function ParentPicker({ id, selected, selectedLabel, disabled, read, onChange }: { id?: string; selected: string | null; selectedLabel: string; disabled: boolean; read: Reader; onChange: (id: string | null, label: string) => void }) {
  const [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState(""), [data, setData] = useState<TaxonomyView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const live = useRef(true), ticket = useRef(0);
  useEffect(() => { live.current = true; const cancel = () => { live.current = false; ticket.current++; }; return cancel; }, []);
  const load = async (page = 1, term = query) => { const current = ++ticket.current; setBusy(true); setError(""); try { const result = await read({ mode: "parents", q: term, page: String(page), ...(id ? { id } : {}) }); if (live.current && current === ticket.current) { setData(result); setAppliedQuery(term); } } catch (cause) { if (live.current && current === ticket.current) setError(cause instanceof Error ? cause.message : "Parent search unavailable."); } finally { if (live.current && current === ticket.current) setBusy(false); } };
  return <fieldset className="space-y-2 rounded border p-3" disabled={disabled}><legend>Parent category</legend><label>Find parent<input aria-label="Find parent" className={input} value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" className={button} disabled={busy || disabled} onClick={() => void load()}>Find parent categories</button>{error && <p role="alert">{error}</p>}<label>Selected parent<select aria-label="Selected parent" className={input} value={selected || ""} onChange={(event) => onChange(event.target.value || null, data?.rows.find((row) => row.id === event.target.value)?.path.join(" / ") || "")}><option value="">No parent (root category)</option>{selected && !data?.rows.some((row) => row.id === selected) && <option value={selected}>{selectedLabel || selected}</option>}{data?.rows.map((row) => <option key={row.id} value={row.id}>{row.path.join(" / ")}</option>)}</select></label>{data && <div className="flex gap-3"><span>{data.total} possible parents · Page {data.page} of {data.totalPages}</span><button type="button" className={button} disabled={busy || disabled || data.page <= 1} onClick={() => void load(data.page - 1, appliedQuery)}>Previous parents</button><button type="button" className={button} disabled={busy || disabled || data.page >= data.totalPages} onClick={() => void load(data.page + 1, appliedQuery)}>Next parents</button></div>}</fieldset>;
}
function History({ id, read }: { id: string; read: Reader }) {
  const [page, setPage] = useState(1), [data, setData] = useState<TaxonomyView | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const live = useRef(true), epoch = useRef(0);
  useEffect(() => { live.current = true; const cancel = () => { live.current = false; epoch.current++; }; return cancel; }, []);
  const load = async () => { const ticket = ++epoch.current; setBusy(true); setError(""); try { const saved = await read({ mode: "history", id, page: String(page) }); if (live.current && ticket === epoch.current) setData(saved); } catch (cause) { if (live.current && ticket === epoch.current) setError(cause instanceof Error ? cause.message : "History unavailable."); } finally { if (live.current && ticket === epoch.current) setBusy(false); } };
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; };
    // This component is keyed by record; page changes reload its bounded history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  return <section aria-label="Catalog history" className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">Catalog history</h2><button className={button} type="button" disabled={busy} onClick={() => void load()}>Reload history</button>{error && <p role="alert">{error}</p>}{data && <><p>{data.total} retained events</p><ol className="space-y-2">{data.events.map((event) => <li key={event.id}><p>{event.action} · {new Date(event.createdAt).toLocaleString("en-BD")} · {event.actorId || "System/import"}</p><details><summary>Saved before/after values</summary><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre></details></li>)}</ol><nav aria-label="Catalog history pages" className="flex gap-3"><button type="button" className={button} disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous history</button><span>Page {data.page} of {data.totalPages}</span><button type="button" className={button} disabled={busy || page >= data.totalPages} onClick={() => setPage(page + 1)}>Next history</button></nav></>}</section>;
}
