"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuthStore } from "@/stores/auth-store";
import { uploadProductImage } from "@/lib/client/product-image-upload";
import { productImageNeedsDirectDelivery, isPublicProductImageUrl } from "@/lib/product-media-policy";
import { bannerFieldsSchema, type BannerFields, type BannerMutation } from "@/lib/validations/banner";
import type { BannerRow, BannerView } from "@/lib/admin-banners";
type Result = { id: string; version: number; deleted: boolean };
type Reply = BannerView & { result: Result; row: BannerRow | null; currentDeleted: boolean };
type Draft = { title: string; subtitle: string; linkUrl: string; placement: BannerFields["placement"]; position: string; isActive: boolean };
const empty = (): Draft => ({ title: "", subtitle: "", linkUrl: "", placement: "HERO", position: "0", isActive: false });
const style = "rounded border p-2";
function BannerWorkspace({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<BannerView | null>(null), [selected, setSelected] = useState<BannerRow | null>(null), [draft, setDraft] = useState<Draft>(empty), [file, setFile] = useState<File | null>(null), [fileEpoch, setFileEpoch] = useState(0), [progress, setProgress] = useState(0);
  const [q, setQ] = useState(""), [placement, setPlacement] = useState("ALL"), [status, setStatus] = useState("ALL"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, setPending] = useState<BannerMutation | null>(null), [confirmed, setConfirmed] = useState(false), [history, setHistory] = useState<BannerView | null>(null), [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const live = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>()), original = useRef<BannerMutation | null>(null);
  const current = () => live.current && useAuthStore.getState().user?.id === ownerId && useAuthStore.getState().user?.role === "ADMIN";
  useEffect(() => { live.current = true; const active = controllers.current; return () => { live.current = false; for (const controller of active) controller.abort(); active.clear(); }; }, []);
  async function request(query = "", body?: BannerMutation): Promise<Reply> {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`/api/admin/banners${query}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Banner-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!current() || controller.signal.aborted) throw new Error("The account changed or request timed out. Reload saved state.");
      if (!response.ok || !value.success) throw new Error(value.message || "The banner operation was not confirmed.");
      if (value.ownerId !== ownerId) throw new Error("The administrator account changed. Reload this page."); return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  function choose(row: BannerRow | null) {
    setSelected(row); setHistory(null); setDeleteConfirmed(false); setFile(null); setFileEpoch((n) => n + 1); setProgress(0);
    setDraft(row ? { title: row.title, subtitle: row.subtitle ?? "", linkUrl: row.linkUrl ?? "", placement: row.placement as BannerFields["placement"], position: String(row.position), isActive: row.isActive } : empty());
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The banner operation failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(page = 1) {
    await run(async () => {
      setConfirmed(false); const saved = await request(`?${new URLSearchParams({ page: String(page), q, placement, status, ...(original.current ? { requestId: original.current.requestId } : {}) })}`);
      if (!Array.isArray(saved.rows) || saved.page !== page) throw new Error("The saved banner list could not be confirmed.");
      setData(saved); setConfirmed(true);
      if (original.current && saved.attempt) {
        if (!saved.attempt.deleted && !saved.attemptedRow && saved.attemptedDeleted !== true) throw new Error("The saved banner could not be confirmed.");
        original.current = null; setPending(null); choose(saved.attemptedRow); setMessage("The original request is recorded. Current saved state loaded.");
      }
    });
  }
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; };
    // Each authenticated owner receives a separately mounted workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = busy || !!pending || !confirmed;
  function fields() {
    const parsed = bannerFieldsSchema.safeParse({ ...draft, subtitle: draft.subtitle.trim() || null, linkUrl: draft.linkUrl.trim() || null, position: draft.position.trim() ? Number(draft.position) : NaN });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Check the banner fields."); return parsed.data;
  }
  async function upload() {
    if (!file) throw new Error("Choose a JPEG, PNG or WebP image first.");
    const controller = new AbortController(); controllers.current.add(controller); setProgress(0);
    try { const uploaded = await uploadProductImage(file, controller.signal, (value) => { if (current()) setProgress(value); }); if (!current() || controller.signal.aborted) throw new Error("The active account changed."); return uploaded.fileKey; }
    finally { controllers.current.delete(controller); }
  }
  async function save(action: "details" | "image" | "activation" | "delete" = "details", retry?: BannerMutation) {
    await run(async () => {
      if (!retry && (original.current || !confirmed)) return;
      let body: BannerMutation;
      if (retry) body = retry;
      else if (action === "details") { const savedFields = fields(); body = selected ? { action: "update", id: selected.id, version: selected.version, requestId: crypto.randomUUID(), fields: savedFields } : { action: "create", requestId: crypto.randomUUID(), fields: savedFields, uploadKey: await upload() }; }
      else {
        if (!selected) throw new Error("Select a saved banner first.");
        const identity = { id: selected.id, version: selected.version, requestId: crypto.randomUUID() };
        if (action === "image") body = { ...identity, action: "image", uploadKey: await upload() };
        else if (action === "activation") body = { ...identity, action: "activation", isActive: !selected.isActive };
        else { if (!deleteConfirmed) throw new Error("Confirm this banner deletion first."); body = { ...identity, action: "delete" }; }
      }
      if (!current()) return; original.current = body; setPending(body); setConfirmed(false);
      const saved = await request("", body);
      if (!saved.result?.id || !Number.isInteger(saved.result.version) || (!saved.result.deleted && !saved.row && saved.currentDeleted !== true)) throw new Error("The saved receipt was not confirmed. Reload before retrying.");
      original.current = null; setPending(null); choose(saved.row); setMessage("Banner change recorded. The homepage uses the saved active placements.");
      const list = await request("?page=1"); setData(list); setQ(""); setPlacement("ALL"); setStatus("ALL"); setConfirmed(true);
    });
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((previous) => ({ ...previous, [key]: value })); setDeleteConfirmed(false); }
  async function showHistory(page = 1) { if (selected) await run(async () => { setHistory(await request(`?mode=history&id=${encodeURIComponent(selected.id)}&page=${page}`)); }); }
  return <section className="space-y-5"><p>Saved active banners appear on their homepage placement. Lower positions appear first; equal positions use stable record IDs. Up to 24 active banners per placement. New banners start inactive.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="flex flex-wrap gap-3"><label>Search title <input className={style} value={q} maxLength={160} disabled={busy} onChange={(event) => setQ(event.target.value)} /></label><label>Placement filter <select className={style} value={placement} disabled={busy} onChange={(event) => setPlacement(event.target.value)}>{["ALL", "HERO", "PROMO", "AD"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Status <select className={style} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>{["ALL", "ACTIVE", "INACTIVE"].map((value) => <option key={value}>{value}</option>)}</select></label><button className={style} disabled={busy} onClick={() => void load()}>Reload saved banners / receipt</button></div>
    {pending && <div className="rounded border p-3"><p>Unconfirmed request: {pending.requestId}. Reload its receipt before retrying. Your typed fields are retained.</p><button className={style} disabled={busy || !confirmed} onClick={() => void save("details", original.current!)}>Retry original request</button> <button className={style} disabled={busy || !confirmed} onClick={() => { original.current = null; setPending(null); setMessage("Unrecorded intent discarded. Review fields and the current revision before saving."); }}>Discard unrecorded intent</button></div>}
    {data && <><div className="overflow-auto"><table className="w-full text-left"><caption>{data.total} saved banners</caption><thead><tr>{["Title", "Placement", "Position", "Active", "Revision", "Action"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-2">{row.title}</td><td>{row.placement}</td><td>{row.position}</td><td>{row.isActive ? "Yes" : "No"}</td><td>{row.version}</td><td><button className={style} disabled={locked} onClick={() => choose(row)}>Edit {row.title}</button></td></tr>)}</tbody></table></div><button className={style} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous</button> <span>Page {data.page} / {data.totalPages}</span> <button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next</button></>}
    <form className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); if (!locked) void save(); }}><h2 className="text-xl font-semibold">{selected ? `Edit ${selected.title} (revision ${selected.version})` : "Create banner"}</h2>
      <button className={style} type="button" disabled={locked} onClick={() => choose(null)}>New banner</button> {selected && <button className={style} type="button" disabled={locked} onClick={() => void run(async () => { const saved = await request(`?mode=record&id=${encodeURIComponent(selected.id)}`); if (!saved.rows[0]) throw new Error("Banner not found."); choose(saved.rows[0]); })}>Load current revision (replace fields)</button>}
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy || !!pending}><label>Title <input className={`${style} w-full`} required maxLength={160} value={draft.title} onChange={(event) => change("title", event.target.value)} /></label><label>Subtitle (optional) <textarea className={`${style} w-full`} maxLength={500} value={draft.subtitle} onChange={(event) => change("subtitle", event.target.value)} /></label><label>Storefront link (optional) <input className={`${style} w-full`} maxLength={2048} placeholder="/products" value={draft.linkUrl} onChange={(event) => change("linkUrl", event.target.value)} /></label><label>Placement <select className={`${style} w-full`} value={draft.placement} onChange={(event) => change("placement", event.target.value as BannerFields["placement"])}>{["HERO", "PROMO", "AD"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Position <input className={`${style} w-full`} type="number" required min="0" max="1000000" step="1" value={draft.position} onChange={(event) => change("position", event.target.value)} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={(event) => change("isActive", event.target.checked)} />Active</label><label>Banner image <input key={fileEpoch} className={style} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setProgress(0); setDeleteConfirmed(false); }} /></label></fieldset>
      <p>JPEG/PNG/WebP, at most 5 MiB and 16 megapixels. Landscape images work best. New banner creation requires an uploaded image; replacing a saved image is a separate revision-bound action.</p>{progress > 0 && <p role="status">Upload {progress}%</p>}
      {selected && isPublicProductImageUrl(selected.imageUrl) && <Image src={selected.imageUrl} alt={selected.title} width={480} height={270} unoptimized={productImageNeedsDirectDelivery(selected.imageUrl)} className="max-h-56 w-auto object-contain" />}
      <button className={style} type="submit" disabled={locked}>{selected ? "Save banner details" : "Upload and create banner"}</button> {selected && <><button className={style} type="button" disabled={locked || !file} onClick={() => void save("image")}>Upload and replace image</button> <button className={style} type="button" disabled={locked} onClick={() => void save("activation")}>{selected.isActive ? "Deactivate saved banner" : "Activate saved banner"}</button> <button className={style} type="button" disabled={busy} onClick={() => void showHistory()}>View saved history</button><label className="block"><input type="checkbox" disabled={locked} checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> I intend to delete this saved banner revision.</label><button className={style} type="button" disabled={locked || !deleteConfirmed} onClick={() => void save("delete")}>Delete selected banner</button></>}
    </form>
    {history && <section className="space-y-2"><h2 className="text-xl font-semibold">Saved banner history</h2>{history.events.map((event) => <details className="rounded border p-2" key={event.id}><summary>{event.action} · {event.createdAt} · actor {event.actorId ?? "database operator"}</summary><pre className="overflow-auto text-xs">{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre></details>)}<button className={style} disabled={busy || history.page <= 1} onClick={() => void showHistory(history.page - 1)}>Previous history</button> <span>{history.page} / {history.totalPages}</span> <button className={style} disabled={busy || history.page >= history.totalPages} onClick={() => void showHistory(history.page + 1)}>Next history</button></section>}
  </section>;
}
export function BannerConsole({ ownerId }: { ownerId: string }) {
  const user = useAuthStore((state) => state.user); if (user?.id !== ownerId || user.role !== "ADMIN") return <p role="status">Confirm your administrator session to load banners.</p>;
  return <BannerWorkspace key={ownerId} ownerId={ownerId} />;
}
