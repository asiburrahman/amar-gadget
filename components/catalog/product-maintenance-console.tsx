"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { maintenanceFieldsSchema, productMaintenanceMutationSchema, type ProductMaintenanceMutation } from "@/lib/validations/product-maintenance";
import { specificationsSchema, type Specification } from "@/lib/validations/specifications";
import { MAX_PRODUCT_PRICE, MAX_PRODUCT_STOCK, MAX_PRODUCT_DESCRIPTION, PRODUCT_STATUSES } from "@/lib/catalog-constants";
import { isPublicProductImageUrl, productImageNeedsDirectDelivery } from "@/lib/product-media-policy";
import { SpecificationEditor } from "@/components/catalog/specification-editor";
import { TaxonomyPicker } from "@/components/catalog/taxonomy-picker";
import type { ProductMaintenanceView, ProductMaintenanceRow } from "@/lib/product-maintenance";
type Result = { id: string; version: number; inventoryVersion: number; status: string; stock: number; action: string };
type Reply = ProductMaintenanceView & { result: Result; row: ProductMaintenanceRow | null; currentUnavailable: boolean };
type Draft = { name: string; description: string; price: string; discountPrice: string; categoryId: string; brandId: string };

const style = "rounded border p-2";
function OwnedCatalog({ ownerId, ownerRole, initialPage }: { ownerId: string; ownerRole: "MEMBER" | "ADMIN"; initialPage: number }) {
  const router = useRouter(), [data, setData] = useState<ProductMaintenanceView | null>(null), [selected, setSelected] = useState<ProductMaintenanceRow | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [specifications, setSpecifications] = useState<Specification[]>([]), [invalidSpecifications, setInvalidSpecifications] = useState(false), [history, setHistory] = useState<ProductMaintenanceView | null>(null);
  const [q, setQ] = useState(""), [status, setStatus] = useState("ALL"), [reason, setReason] = useState(""), [adjustment, setAdjustment] = useState(""), [direction, setDirection] = useState("ADD"), [affirmed, setAffirmed] = useState(false);
  const [operation, setOperation] = useState<"stock" | "archive" | "resubmit">("stock");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [pending, setPending] = useState<ProductMaintenanceMutation | null>(null), [confirmed, setConfirmed] = useState(false);
  const live = useRef(false), working = useRef(false), original = useRef<ProductMaintenanceMutation | null>(null), controllers = useRef(new Set<AbortController>());
  const current = () => { const actor = useAuthStore.getState().user; return live.current && actor?.id === ownerId && actor.role === ownerRole && (actor.role === "ADMIN" || actor.sellerStatus === "APPROVED"); };
  useEffect(() => { live.current = true; const active = controllers.current; return () => { live.current = false; for (const controller of active) controller.abort(); active.clear(); }; }, []);
  async function request(query = "", body?: ProductMaintenanceMutation): Promise<Reply> {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`/api/member/products${query}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Product-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json(); if (!current() || controller.signal.aborted) throw new Error("The active account or request changed. Reload your catalog.");
      if (!response.ok || !value.success) throw new Error(value.message || "The catalog operation was not confirmed.");
      if (value.ownerId !== ownerId) throw new Error("The catalog owner changed. Reload this page."); return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  function choose(row: ProductMaintenanceRow | null) {
    setSelected(row); setHistory(null); setReason(""); setAdjustment(""); setDirection("ADD"); setOperation("stock"); setAffirmed(false);
    setDraft(row ? { name: row.name, description: row.description ?? "", price: String(row.price), discountPrice: row.discountPrice === null ? "" : String(row.discountPrice), categoryId: row.categoryId, brandId: row.brandId ?? "" } : null);
    const specs = specificationsSchema.safeParse(row?.specifications ?? []); setSpecifications(specs.success ? specs.data : []); setInvalidSpecifications(!specs.success);
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The catalog request failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(page = 1) {
    await run(async () => {
      setConfirmed(false); const saved = await request(`?${new URLSearchParams({ page: String(page), q, status, ...(original.current ? { requestId: original.current.requestId } : {}) })}`);
      if (!Array.isArray(saved.rows) || saved.page !== page) throw new Error("The saved catalog page could not be confirmed."); setData(saved); setConfirmed(true);
      if (original.current && saved.attempt) { original.current = null; setPending(null); choose(saved.attemptedRow); setMessage("The original change is recorded. Current owned-product state loaded."); }
    });
  }
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) { void load(initialPage); } }); return () => { cancelled = true; };
    // Owner and role lifetimes are keyed by the parent; list reload never rebases a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = busy || !!pending || !confirmed;
  function fields() {
    if (!draft || invalidSpecifications) throw new Error("Review the saved specifications before editing this product.");
    const parsed = maintenanceFieldsSchema.safeParse({ ...draft, description: draft.description || null, price: draft.price.trim() ? Number(draft.price) : NaN, discountPrice: draft.discountPrice.trim() ? Number(draft.discountPrice) : null, brandId: draft.brandId || null, specifications });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Check the catalog fields."); return parsed.data;
  }
  async function save(action: ProductMaintenanceMutation["action"], retry?: ProductMaintenanceMutation) {
    await run(async () => {
      if (!selected || (!retry && (original.current || !confirmed))) return;
      if (action !== "edit" && !retry && operation !== action) throw new Error("Choose and confirm the intended operation first.");
      const identity = { id: selected.id, version: selected.catalogVersion, requestId: crypto.randomUUID(), reason };
      const raw = retry ?? (action === "edit" ? { ...identity, action, fields: fields() } : action === "stock" ? { ...identity, action, inventoryVersion: selected.inventoryVersion, delta: (direction === "ADD" ? 1 : -1) * (adjustment.trim() ? Number(adjustment) : NaN), confirmed: affirmed } : { ...identity, action, confirmed: affirmed });
      const parsed = productMaintenanceMutationSchema.safeParse(raw); if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Check the reason, quantity and selected revision.");
      const intent = parsed.data; original.current = intent; setPending(intent); setConfirmed(false);
      const saved = await request("", intent); if (!saved.result?.id || !Number.isInteger(saved.result.version) || (!saved.row && !saved.currentUnavailable)) throw new Error("The saved receipt could not be confirmed. Reload before retrying.");
      original.current = null; setPending(null); choose(saved.row); setMessage(saved.currentUnavailable ? "The original change is recorded; this product is no longer in your current catalog." : "Product change recorded. Catalog content requires review; stock adjustments preserve the saved publication status.");
      const list = await request("?page=1"); setData(list); setQ(""); setStatus("ALL"); setConfirmed(true); router.refresh();
    });
  }
  function change(key: keyof Draft, value: string) { setDraft((prior) => prior ? { ...prior, [key]: value } : null); setAffirmed(false); }
  async function showHistory(page = 1) { if (selected) await run(async () => { setHistory(await request(`?mode=history&id=${encodeURIComponent(selected.id)}&page=${page}`)); }); }
  return <section className="space-y-5"><nav className="flex flex-wrap gap-4"><Link className="underline" href="/member/add-product">Add product</Link><Link className="underline" href="/member/orders">My shipments</Link><Link className="underline" href="/member/dashboard">Seller dashboard</Link></nav><p>Content, price and image changes require administrator review. Inventory adjustments are separate, revision-checked changes to available units. Archiving stops new purchases and retains existing orders; resubmission returns the product to review.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="flex flex-wrap gap-3"><label>Product name or exact ID <input className={style} value={q} maxLength={120} disabled={busy} onChange={(event) => setQ(event.target.value)} /></label><label>Catalog status <select className={style} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>{["ALL", ...PRODUCT_STATUSES].map((value) => <option key={value}>{value}</option>)}</select></label><button className={style} disabled={busy} onClick={() => void load()}>Reload saved catalog / receipt</button></div>
    {pending && <div className="rounded border p-3"><p>Unconfirmed request: {pending.requestId}. Reload its saved receipt before retrying the identical operation. Your typed fields remain available.</p><button className={style} disabled={busy || !confirmed} onClick={() => original.current && void save(original.current.action, original.current)}>Retry original request</button> <button className={style} disabled={busy || !confirmed} onClick={() => { original.current = null; setPending(null); setAffirmed(false); setMessage("Unrecorded intent discarded. Reload the current product revision before making a new decision."); }}>Discard unrecorded intent</button></div>}
    {data && <><div className="overflow-auto"><table className="w-full text-left"><caption>{data.total} products in your catalog</caption><thead><tr>{["Product", "Status", "Price (BDT)", "Available units", "Purchase lines", "Catalog / stock revision", "Actions"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-2">{row.name}</td><td>{row.status}</td><td>{row.price.toFixed(2)}{row.discountPrice !== null && ` / sale ${row.discountPrice.toFixed(2)}`}</td><td>{row.stock}</td><td>{row._count.orderItems}</td><td>{row.catalogVersion} / {row.inventoryVersion}</td><td><button className={style} disabled={locked} onClick={() => choose(row)}>Edit {row.name}</button> <Link className="underline" href={`/member/products/${row.id}/images`}>Manage images</Link></td></tr>)}</tbody></table></div>{!data.rows.length && <p>No products match these filters.</p>}<button className={style} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous products</button> <span>Page {data.page} / {data.totalPages}</span> <button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next products</button></>}
    {selected && draft && <div className="space-y-4 rounded border p-4"><h2 className="text-xl font-semibold">Edit {selected.name} (catalog {selected.catalogVersion}, stock {selected.inventoryVersion})</h2><p>Saved status: {selected.status}. Available units: {selected.stock}. {selected._count.orderItems} purchase lines retain this product and their captured labels/prices.</p><button className={style} disabled={locked} onClick={() => void run(async () => { const saved = await request(`?mode=record&id=${encodeURIComponent(selected.id)}`); if (!saved.rows[0]) throw new Error("Product is no longer in your catalog."); choose(saved.rows[0]); })}>Load current revision (replace fields)</button> <button className={style} disabled={busy} onClick={() => void showHistory()}>View product history</button> <Link className="underline" href={`/member/products/${selected.id}/images`}>Edit this product gallery</Link>
      {isPublicProductImageUrl(selected.imageUrl ?? "") && <Image src={selected.imageUrl!} alt={selected.name} width={320} height={240} unoptimized={productImageNeedsDirectDelivery(selected.imageUrl!)} className="max-h-48 w-auto object-contain" />}
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!locked) void save("edit"); }}><fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy || !!pending}><label>Product name <input className={`${style} w-full`} required minLength={3} maxLength={120} value={draft.name} onChange={(event) => change("name", event.target.value)} /></label><TaxonomyPicker key={selected.id + ":category"} kind="category" required value={draft.categoryId} savedChoice={{ id: selected.categoryId, name: selected.category.name }} onChange={(id) => change("categoryId", id)} disabled={busy || !!pending} /><TaxonomyPicker key={selected.id + ":brand"} kind="brand" value={draft.brandId} savedChoice={selected.brandId && selected.brand ? { id: selected.brandId, name: selected.brand.name } : undefined} onChange={(id) => change("brandId", id)} disabled={busy || !!pending} /><label>Price (BDT) <input className={`${style} w-full`} type="number" min="0.01" max={MAX_PRODUCT_PRICE} step="0.01" required value={draft.price} onChange={(event) => change("price", event.target.value)} /></label><label>Discount price (BDT, optional) <input className={`${style} w-full`} type="number" min="0.01" max={MAX_PRODUCT_PRICE} step="0.01" value={draft.discountPrice} onChange={(event) => change("discountPrice", event.target.value)} /></label><label>Description <textarea className={`${style} w-full`} maxLength={MAX_PRODUCT_DESCRIPTION} value={draft.description} onChange={(event) => change("description", event.target.value)} /></label></fieldset>
        {invalidSpecifications ? <div role="alert"><p>The saved legacy specifications need review. They will not be silently replaced.</p><pre className="overflow-auto text-xs">{JSON.stringify(selected.specifications, null, 2)}</pre><button className={style} type="button" disabled={locked} onClick={() => { setSpecifications([]); setInvalidSpecifications(false); setAffirmed(false); }}>Replace invalid specifications with an empty list</button></div> : <SpecificationEditor value={specifications} disabled={busy || !!pending} onChange={(next) => { setSpecifications(next); setAffirmed(false); }} />}
        <button className={style} type="submit" disabled={locked || invalidSpecifications || reason.trim().length < 5}>Save catalog content for review</button></form>
      <label className="block">Operation reason <input className={`${style} w-full`} minLength={5} maxLength={300} disabled={busy || !!pending} value={reason} onChange={(event) => { setReason(event.target.value); setAffirmed(false); }} /></label>
      <div className="space-y-3 rounded border p-3"><h3 className="font-semibold">Adjust available inventory</h3><div className="flex flex-wrap gap-3"><label>Adjustment <select className={style} disabled={busy || !!pending} value={direction} onChange={(event) => { setDirection(event.target.value); setAffirmed(false); }}><option value="ADD">Add received units</option><option value="REMOVE">Remove available units</option></select></label><label>Units <input className={style} type="number" min="1" max={MAX_PRODUCT_STOCK} step="1" disabled={busy || !!pending} value={adjustment} onChange={(event) => { setAdjustment(event.target.value); setAffirmed(false); }} /></label></div><p>Adjusts the latest saved stock only if both displayed revisions still match. A checkout or return can require reloading first. This does not overwrite stock with an old total.</p></div>
      <label className="block">Operation to confirm <select className={style} disabled={busy || !!pending} value={operation} onChange={(event) => { setOperation(event.target.value as "stock" | "archive" | "resubmit"); setAffirmed(false); }}><option value="stock">Inventory adjustment</option>{selected.status !== "ARCHIVED" && <option value="archive">Archive product</option>}{["ARCHIVED", "REJECTED"].includes(selected.status) && <option value="resubmit">Submit saved product for review</option>}</select></label><label className="block"><input type="checkbox" disabled={busy || !!pending} checked={affirmed} onChange={(event) => setAffirmed(event.target.checked)} /> I confirm the displayed product/revisions and the selected operation: {operation}.</label><div className="flex flex-wrap gap-3"><button className={style} disabled={locked || operation !== "stock" || !affirmed || !adjustment.trim() || reason.trim().length < 5} onClick={() => void save("stock")}>Apply inventory adjustment</button>{selected.status !== "ARCHIVED" ? <button className={style} disabled={locked || operation !== "archive" || !affirmed || reason.trim().length < 5} onClick={() => void save("archive")}>Archive saved product</button> : <button className={style} disabled={locked || operation !== "resubmit" || !affirmed || reason.trim().length < 5} onClick={() => void save("resubmit")}>Restore and submit for review</button>}{selected.status === "REJECTED" && <button className={style} disabled={locked || operation !== "resubmit" || !affirmed || reason.trim().length < 5} onClick={() => void save("resubmit")}>Resubmit saved product for review</button>}</div>
    </div>}
    {history && <section className="space-y-2"><h2 className="text-xl font-semibold">Product and inventory history</h2>{history.events.map((event) => <details className="rounded border p-2" key={event.id}><summary>{event.createdAt} · {event.reason ?? "Checkout, return or catalog workflow"} · actor {event.actorId ?? "workflow/operator"}</summary><pre className="overflow-auto text-xs">{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre></details>)}<button className={style} disabled={busy || history.page <= 1} onClick={() => void showHistory(history.page - 1)}>Previous history</button> <span>{history.page} / {history.totalPages}</span> <button className={style} disabled={busy || history.page >= history.totalPages} onClick={() => void showHistory(history.page + 1)}>Next history</button></section>}
  </section>;
}
export function ProductMaintenanceConsole({ ownerId, ownerRole, initialPage = 1 }: { ownerId: string; ownerRole: "MEMBER" | "ADMIN"; initialPage?: number }) {
  const { user, loading } = useAuth(); if (loading) return <p role="status">Loading your catalog account…</p>;
  if (user?.id !== ownerId || user.role !== ownerRole || (user.role === "MEMBER" && user.sellerStatus !== "APPROVED")) return <p role="status">Approved matching catalog-owner access is required.</p>;
  return <OwnedCatalog key={`${ownerId}:${ownerRole}`} ownerId={ownerId} ownerRole={ownerRole} initialPage={initialPage} />;
}
