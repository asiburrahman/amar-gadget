"use client";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import type { CouponRow, CouponView } from "@/lib/admin-coupons";
import { couponFieldsSchema, type CouponAction, type CouponFields } from "@/lib/validations/coupon";
import type { checkoutTotals } from "@/lib/coupon-policy";

type Mutation = Exclude<CouponAction, { action: "preview" }>;
type Draft = { code: string; discount: string; isPercentage: boolean; minSpend: string; expiresAt: string; isActive: boolean };
type Reply = CouponView & { success: boolean; message?: string; kind?: "saved" | "preview"; row?: CouponRow; totals?: ReturnType<typeof checkoutTotals>; evaluatedAt?: string };
const empty = (): Draft => ({ code: "", discount: "", isPercentage: true, minSpend: "", expiresAt: "", isActive: false });
const style = "rounded border p-2";
function CouponWorkspace({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<CouponView | null>(null), [selected, setSelected] = useState<CouponRow | null>(null), [draft, setDraft] = useState<Draft>(empty);
  const [q, setQ] = useState(""), [status, setStatus] = useState("ALL"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, setPending] = useState<Mutation | null>(null), [confirmed, setConfirmed] = useState(false), [history, setHistory] = useState<CouponView | null>(null);
  const [subtotal, setSubtotal] = useState(""), [method, setMethod] = useState<"COD" | "STRIPE">("COD"), [preview, setPreview] = useState<{ totals: ReturnType<typeof checkoutTotals>; at: string } | null>(null);
  const live = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>()), original = useRef<Mutation | null>(null);
  const current = () => live.current && useAuthStore.getState().user?.id === ownerId && useAuthStore.getState().user?.role === "ADMIN";
  useEffect(() => { live.current = true; const active = controllers.current; return () => { live.current = false; for (const controller of active) controller.abort(); active.clear(); }; }, []);
  async function request(query = "", body?: CouponAction): Promise<Reply> {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`/api/admin/coupons${query}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Coupon-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!current() || controller.signal.aborted) throw new Error("The account changed or the request timed out. Reload saved state.");
      if (!response.ok || !value.success) throw new Error(value.message || "The coupon operation was not confirmed.");
      if (value.ownerId !== ownerId) throw new Error("The active administrator changed. Reload this page.");
      return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  function choose(row: CouponRow | null) {
    setSelected(row); setHistory(null); setPreview(null);
    setDraft(row ? { code: row.code, discount: String(row.discount), isPercentage: row.isPercentage, minSpend: row.minSpend === null ? "" : String(row.minSpend), expiresAt: row.expiresAt ?? "", isActive: row.isActive } : empty());
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(page = 1) {
    await run(async () => {
      setConfirmed(false);
      const saved = await request(`?${new URLSearchParams({ page: String(page), q, status, ...(original.current ? { requestId: original.current.requestId } : {}) })}`);
      if (!Array.isArray(saved.rows) || saved.page !== page) throw new Error("The saved coupon list could not be confirmed.");
      setData(saved); setConfirmed(true);
      if (original.current && saved.attempt && saved.attemptedRow) {
        original.current = null; setPending(null); choose(saved.attemptedRow); setMessage("The original request is recorded. Current saved coupon loaded.");
      }
    });
  }
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; };
    // This workspace is remounted for each authenticated owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = busy || !!pending || !confirmed;
  function fields(): CouponFields {
    if (!draft.discount.trim()) throw new Error("Enter a discount amount.");
    return couponFieldsSchema.parse({ ...draft, discount: Number(draft.discount), minSpend: draft.minSpend.trim() ? Number(draft.minSpend) : null, expiresAt: draft.expiresAt || null });
  }
  async function save(body?: Mutation) {
    await run(async () => {
      if (!body && (original.current || !confirmed)) return;
      const intent: Mutation = body ?? (selected ? { action: "update", id: selected.id, version: selected.version, requestId: crypto.randomUUID(), fields: fields() } : { action: "create", requestId: crypto.randomUUID(), fields: fields() });
      original.current = intent; setPending(intent); setConfirmed(false); setPreview(null);
      const result = await request("", intent);
      if (result.kind !== "saved" || !result.row?.id || !Number.isInteger(result.row.version)) throw new Error("The saved receipt was not confirmed. Reload before retrying.");
      original.current = null; setPending(null); choose(result.row); setMessage("Coupon saved. Reload the list to see current records.");
      // Do not rebase another typed draft from an asynchronous list refresh.
      const saved = await request("?page=1"); setData(saved); setQ(""); setStatus("ALL"); setConfirmed(true);
    });
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((prior) => ({ ...prior, [key]: value })); setPreview(null); }
  async function showHistory(page = 1) { if (selected) await run(async () => { setHistory(await request(`?${new URLSearchParams({ mode: "history", id: selected.id, page: String(page) })}`)); }); }
  return <section className="space-y-5">
    <p>Coupon rules apply to new checkout quotes. Existing orders keep their recorded prices. Expiry is entered in UTC.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="flex flex-wrap items-end gap-3"><label>Search code <input className={style} value={q} maxLength={64} disabled={busy} onChange={(event) => setQ(event.target.value)} /></label><label>Status <select className={style} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>{["ALL", "ACTIVE", "INACTIVE", "EXPIRED"].map((value) => <option key={value}>{value}</option>)}</select></label><button className={style} disabled={busy} onClick={() => void load()}>Reload saved coupons / receipt</button></div>
    {pending && <div className="space-y-2 rounded border p-3"><p>Unconfirmed request: {pending.requestId}. Reload its receipt before retrying. Your typed fields remain available.</p><button className={style} disabled={busy || !confirmed} onClick={() => void save(original.current!)}>Retry original request</button> <button className={style} disabled={busy || !confirmed} onClick={() => { original.current = null; setPending(null); setMessage("Unrecorded intent discarded. Review your fields and current revision before saving again."); }}>Discard unrecorded intent</button></div>}
    {data && <><div className="overflow-auto"><table className="w-full text-left"><caption>{data.total} saved coupons</caption><thead><tr>{["Code", "Discount", "Min spend", "Expiry (UTC)", "Status", "Orders", "Revision", "Action"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-2">{row.code}</td><td>{row.discount}{row.isPercentage ? "%" : " BDT"}</td><td>{row.minSpend ?? "None"}</td><td>{row.expiresAt ?? "None"}</td><td>{row.status}</td><td>{row.usedOrders}</td><td>{row.version}</td><td><button className={style} disabled={locked} onClick={() => choose(row)}>Edit</button></td></tr>)}</tbody></table></div><div className="flex gap-3"><button className={style} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous</button><span>Page {data.page} / {data.totalPages}</span><button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next</button></div></>}
    <form className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); if (!locked) void save(); }}>
      <h2 className="text-xl font-semibold">{selected ? `Edit ${selected.code} (revision ${selected.version})` : "Create coupon"}</h2>
      <button className={style} type="button" disabled={locked} onClick={() => choose(null)}>New coupon</button>
      {selected && <button className={style} type="button" disabled={locked} onClick={() => void run(async () => { const saved = await request(`?mode=record&id=${encodeURIComponent(selected.id)}`); if (!saved.rows[0]) throw new Error("Coupon not found."); choose(saved.rows[0]); })}>Load current revision (replace fields)</button>}
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy || !!pending}>
        <label>Code <input className={`${style} w-full`} required maxLength={64} value={draft.code} onChange={(event) => change("code", event.target.value)} /></label>
        <label>Discount type <select className={`${style} w-full`} value={draft.isPercentage ? "percentage" : "fixed"} onChange={(event) => change("isPercentage", event.target.value === "percentage")}><option value="percentage">Percentage</option><option value="fixed">Fixed BDT</option></select></label>
        <label>Discount <input className={`${style} w-full`} type="number" step="0.01" min="0.01" max={draft.isPercentage ? 100 : 99999999.99} required value={draft.discount} onChange={(event) => change("discount", event.target.value)} /></label>
        <label>Minimum subtotal (BDT, optional) <input className={`${style} w-full`} type="number" step="0.01" min="0" max="99999999.99" value={draft.minSpend} onChange={(event) => change("minSpend", event.target.value)} /></label>
        <label>Expires at (UTC, optional) <input className={`${style} w-full`} type="datetime-local" step="0.001" value={draft.expiresAt ? draft.expiresAt.slice(0, -1) : ""} onChange={(event) => change("expiresAt", event.target.value ? new Date(`${event.target.value}Z`).toISOString() : "")} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={(event) => change("isActive", event.target.checked)} />Active</label>
      </fieldset>
      <button className={style} disabled={locked} type="submit">{selected ? "Save current revision" : "Create coupon"}</button>
      {selected && <><button className={style} type="button" disabled={locked} onClick={() => void save({ action: "activation", requestId: crypto.randomUUID(), id: selected.id, version: selected.version, isActive: !selected.isActive })}>{selected.isActive ? "Deactivate saved coupon" : "Activate saved coupon"}</button> <button className={style} type="button" disabled={busy} onClick={() => void showHistory()}>View saved history</button></>}
    </form>
    <div className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">Preview current draft</h2><p>Enter the subtotal after product discounts, before coupon and shipping. Checkout rechecks actual products, stock and coupon rules. Preview saves nothing.</p>
      <label>Subtotal (BDT) <input className={style} type="number" min="0" step="0.01" value={subtotal} disabled={busy} onChange={(event) => { setSubtotal(event.target.value); setPreview(null); }} /></label> <label>Payment <select className={style} value={method} disabled={busy} onChange={(event) => { setMethod(event.target.value as "COD" | "STRIPE"); setPreview(null); }}><option>COD</option><option>STRIPE</option></select></label> <button className={style} disabled={busy || !!pending} onClick={() => void run(async () => { setPreview(null); if (!subtotal.trim()) throw new Error("Enter a subtotal."); const result = await request("", { action: "preview", target: selected ? { id: selected.id, version: selected.version } : null, fields: fields(), subtotal: Number(subtotal), paymentMethod: method }); if (result.kind !== "preview" || !result.totals || !result.evaluatedAt) throw new Error("Preview could not be confirmed."); setPreview({ totals: result.totals, at: result.evaluatedAt }); })}>Calculate preview</button>
      {preview && <p role="status">BDT subtotal {preview.totals.subtotal.toFixed(2)} − coupon {preview.totals.discountAmount.toFixed(2)} + shipping {preview.totals.shippingFee.toFixed(2)} = total {preview.totals.total.toFixed(2)}. Evaluated {preview.at}.</p>}
    </div>
    {history && <section className="space-y-2"><h2 className="text-xl font-semibold">Saved coupon history</h2>{history.events.map((event) => <details className="rounded border p-2" key={event.id}><summary>{event.action} · {event.createdAt} · actor {event.actorId ?? "database operator"}</summary><pre className="overflow-auto text-xs">{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre></details>)}<button className={style} disabled={busy || history.page <= 1} onClick={() => void showHistory(history.page - 1)}>Previous history</button> <span>{history.page} / {history.totalPages}</span> <button className={style} disabled={busy || history.page >= history.totalPages} onClick={() => void showHistory(history.page + 1)}>Next history</button></section>}
  </section>;
}
export function CouponConsole({ ownerId }: { ownerId: string }) {
  const user = useAuthStore((state) => state.user);
  if (user?.id !== ownerId || user.role !== "ADMIN") return <p role="status">Confirm your administrator session to load coupons.</p>;
  return <CouponWorkspace key={ownerId} ownerId={ownerId} />;
}
