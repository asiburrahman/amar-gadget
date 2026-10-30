"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { FULFILLMENT_STATES, fulfillmentStatusLabel } from "@/lib/fulfillment-policy";
import { formatCurrency } from "@/lib/formatter";
import type { SellerFulfillment } from "@/lib/validations/fulfillment";

type Role = "ADMIN" | "MEMBER";
type Row = SellerFulfillment & { seller?: { id: string; name: string | null; email: string; sellerStatus: string }; orderTotal?: number; orderVersion?: number };
type Page = { ownerId: string; shipments: Row[]; page: number; total: number; totalPages: number };
type Draft = { carrier: string; trackingNumber: string; version: number };
type HistoryEvent = { id: string; kind: string; status: string; carrier: string | null; trackingNumber: string | null; actorRole: string | null; occurredAt: string | null; recordedAt: string };
type History = { events: HistoryEvent[]; nextCursor: string | null; version: number };
export function FulfillmentConsole({ role, orderId }: { role: Role; orderId?: string }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading account...</p>;
  if (!user || user.role !== role || (role === "MEMBER" && user.sellerStatus !== "APPROVED")) return <p>Shipment management is available to an approved seller or administrator in the matching account area.</p>;
  return <OwnedFulfillmentConsole key={`${user.id}:${role}:${orderId || "all"}`} ownerId={user.id} role={role} orderId={orderId} />;
}
function OwnedFulfillmentConsole({ ownerId, role, orderId }: { ownerId: string; role: Role; orderId?: string }) {
  const router = useRouter(), endpoint = role === "ADMIN" ? "/api/admin/fulfillments" : "/api/member/fulfillments";
  const [page, setPage] = useState(1), [filter, setFilter] = useState("ALL"), [data, setData] = useState<Page | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), [histories, setHistories] = useState<Record<string, History>>({});
  const [needsReload, setNeedsReload] = useState<Record<string, boolean>>({});
  const [collections, setCollections] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const live = useRef(false), working = useRef(false), epoch = useRef(0), controllers = useRef(new Set<AbortController>());
  const current = () => { const user = useAuthStore.getState().user; return live.current && user?.id === ownerId && user.role === role && (role !== "MEMBER" || user.sellerStatus === "APPROVED"); };
  useEffect(() => {
    live.current = true;
    const activeControllers = controllers.current;
    const cancel = () => { live.current = false; epoch.current++; working.current = false; for (const controller of activeControllers) controller.abort(); activeControllers.clear(); };
    return cancel;
  }, []);
  const request = async (path: string, method = "GET", body?: unknown) => {
    const controller = new AbortController(); controllers.current.add(controller);
    const deadline = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(path, { method, cache: "no-store", headers: { "X-Fulfillment-Owner": ownerId, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      const value = await response.json();
      if (controller.signal.aborted) throw new Error("Shipment request timed out. Reload its saved state before retrying.");
      if (!response.ok || !value.success) throw new Error(typeof value.message === "string" ? value.message : "Unable to confirm the shipment request.");
      if (value.ownerId !== ownerId) throw new Error("The active account changed. Reload your session.");
      return value;
    } finally { clearTimeout(deadline); controllers.current.delete(controller); }
  };
  const load = async () => {
    if (!current() || working.current) return;
    const ticket = ++epoch.current; working.current = true; setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), status: filter, ...(orderId ? { orderId } : {}) });
      const next: Page = await request(`${endpoint}?${query}`);
      if (!current() || epoch.current !== ticket) return;
      if (!Array.isArray(next.shipments) || !Number.isInteger(next.total) || !Number.isInteger(next.totalPages) || next.page !== page) throw new Error("Unable to confirm this shipment list. Reload it.");
      setData(next); setNeedsReload({});
    } catch (cause) { if (current() && epoch.current === ticket) setError(cause instanceof Error ? cause.message : "Unable to load shipments."); }
    finally { if (epoch.current === ticket) { working.current = false; if (current()) setBusy(false); } }
  };
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    // Each owner/role/order view is keyed by its parent. Filter/page loads
    // preserve draft maps; only unmount cancels all requests for that account.
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter]);
  const save = async (row: Row, action: "ship" | "tracking" | "deliver" | "collect-cod") => {
    if (!current() || working.current || needsReload[row.id]) return;
    const draft = drafts[row.id] || { carrier: row.carrier || "", trackingNumber: row.trackingNumber || "", version: row.version };
    const delivery = action === "deliver" || action === "collect-cod";
    if (!delivery && draft.version !== row.version) return;
    if (delivery && row.paymentMethod === "COD" && collections[row.id] !== row.version) return;
    const ticket = ++epoch.current; working.current = true; setBusy(true); setError(""); setMessage(""); let saved = false;
    try {
      const result = await request(endpoint, "POST", delivery ? { fulfillmentId: row.id, version: row.version, action, codMoneyReceived: row.paymentMethod === "COD" && collections[row.id] === row.version } : { fulfillmentId: row.id, version: draft.version, action, carrier: draft.carrier, trackingNumber: draft.trackingNumber });
      if (!current() || epoch.current !== ticket) return;
      if (result.shipment?.id !== row.id || !Number.isInteger(result.shipment.version)) throw new Error("The saved shipment was not confirmed. Reload before retrying.");
      setData((value) => value ? { ...value, shipments: value.shipments.map((item) => item.id === row.id ? { ...item, ...result.shipment } : item) } : value);
      setDrafts((value) => { const next = { ...value }; delete next[row.id]; return next; });
      setHistories((value) => { const next = { ...value }; delete next[row.id]; return next; });
      setCollections((value) => { const next = { ...value }; delete next[row.id]; return next; });
      setMessage(action === "deliver" ? "Shipment delivery confirmed." : action === "collect-cod" ? "This shipment's COD collection was recorded." : action === "ship" ? "Your shipment was marked as shipped." : "Shipment tracking details saved."); saved = true;
      router.refresh();
    } catch (cause) { if (current()) { setNeedsReload((value) => ({ ...value, [row.id]: true })); setError(cause instanceof Error ? cause.message : "Shipment was not confirmed. Reload before retrying."); } }
    finally { if (epoch.current === ticket) { working.current = false; if (current()) setBusy(false); } }
    if (saved && current()) await load();
  };
  const loadHistory = async (row: Row, more = false) => {
    if (!current() || working.current) return;
    working.current = true; setBusy(true); setError(""); const ticket = ++epoch.current;
    try {
      const cursor = more ? histories[row.id]?.nextCursor : null;
      const result = await request(`/api/fulfillments/${encodeURIComponent(row.id)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!current() || epoch.current !== ticket) return;
      if (result.fulfillmentId !== row.id || !Array.isArray(result.events)) throw new Error("Unable to confirm the shipment history.");
      setHistories((value) => ({ ...value, [row.id]: { version: result.version, nextCursor: result.nextCursor, events: more ? [...new Map([...(value[row.id]?.events || []), ...result.events].map((event) => [event.id, event])).values()] : result.events } }));
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Unable to load shipment history."); }
    finally { if (epoch.current === ticket) { working.current = false; if (current()) setBusy(false); } }
  };
  return <section className="space-y-4" aria-label={role === "ADMIN" ? "Administrator shipments" : "My seller shipments"}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm">Shipment status<select aria-label="Shipment status" value={filter} disabled={busy} onChange={(event) => { setFilter(event.target.value); setPage(1); }} className="block rounded border bg-background p-2"><option value="ALL">All shipments</option>{FULFILLMENT_STATES.map((state) => <option key={state} value={state}>{fulfillmentStatusLabel(state)}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => void load()} className="rounded border px-3 py-2 disabled:opacity-50">Reload saved shipments</button>
    </div>
    {busy && <p role="status">Loading or saving shipment...</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    {data && <p>{data.total} shipments · Page {data.page} of {data.totalPages}</p>}
    {data?.shipments.length === 0 && !error && <p>No shipments match this view.</p>}
    {data?.shipments.map((row) => {
      const draft = drafts[row.id], stale = !!draft && draft.version !== row.version, active = ["PROCESSING", "SHIPPED"].includes(row.status), history = histories[row.id];
      return <article key={row.id} className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">Order {row.orderTrackingCode || row.orderId} · {fulfillmentStatusLabel(row.status)}</h2><p>{row.paymentMethod} · {row.paymentStatus === "PAID" ? "Payment confirmed" : "Payment not confirmed"}</p></div>
        {role === "ADMIN" && row.seller && <p>Seller: {row.seller.name || row.seller.email} ({row.seller.sellerStatus})</p>}
        <p className="text-sm">Deliver to: {row.recipientAddress || "Address unavailable"}{row.recipientPhone ? ` · ${row.recipientPhone}` : ""}</p>
        <ul className="space-y-1 text-sm">{row.items.map((item) => <li key={item.id}>{item.name} × {item.quantity} · {formatCurrency(item.unitPrice * item.quantity)}</li>)}</ul>
        <p className="text-sm">Shipment item subtotal before order-level discounts: {formatCurrency(row.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0))}</p>
        {row.shippedAt && <p className="text-sm">Shipped: <time dateTime={row.shippedAt}>{new Date(row.shippedAt).toLocaleString("en-BD")}</time></p>}
        {row.deliveredAt && <p className="text-sm">Delivered: <time dateTime={row.deliveredAt}>{new Date(row.deliveredAt).toLocaleString("en-BD")}</time></p>}
        {row.legacySnapshot && !row.shippedAt && !row.deliveredAt && ["SHIPPED", "DELIVERED"].includes(row.status) && <p>Earlier status retained; its transition time was not recorded.</p>}
        {active ? <form onSubmit={(event) => { event.preventDefault(); void save(row, "tracking"); }} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm" htmlFor={`carrier-${row.id}`}>Carrier<input id={`carrier-${row.id}`} required minLength={2} maxLength={80} value={draft?.carrier ?? row.carrier ?? ""} disabled={busy} onChange={(event) => setDrafts((value) => ({ ...value, [row.id]: { ...(value[row.id] || { carrier: row.carrier || "", trackingNumber: row.trackingNumber || "", version: row.version }), carrier: event.target.value } }))} className="block w-full rounded border bg-background p-2" /></label>
            <label className="text-sm" htmlFor={`tracking-${row.id}`}>Package tracking number<input id={`tracking-${row.id}`} required minLength={2} maxLength={120} value={draft?.trackingNumber ?? row.trackingNumber ?? ""} disabled={busy} onChange={(event) => setDrafts((value) => ({ ...value, [row.id]: { ...(value[row.id] || { carrier: row.carrier || "", trackingNumber: row.trackingNumber || "", version: row.version }), trackingNumber: event.target.value } }))} className="block w-full rounded border bg-background p-2" /></label>
          </div>
          {needsReload[row.id] && <p>Reload the saved shipments before retrying. Your typed tracking details are retained.</p>}
          {stale && <div className="space-y-2"><p>This shipment changed. Saved tracking: {row.carrier || "None"} / {row.trackingNumber || "None"}. Your typed changes are retained.</p><button type="button" disabled={busy || needsReload[row.id]} onClick={() => setDrafts((value) => ({ ...value, [row.id]: { ...value[row.id], version: row.version } }))} className="underline">Keep my changes against the reloaded shipment</button></div>}
          <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || stale || needsReload[row.id]} className="rounded border px-3 py-2 disabled:opacity-50">Save tracking details</button>{row.status === "PROCESSING" && <button type="button" disabled={busy || stale || needsReload[row.id]} onClick={() => void save(row, "ship")} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">Mark my shipment as shipped</button>}{draft && <button type="button" disabled={busy} onClick={() => setDrafts((value) => { const next = { ...value }; delete next[row.id]; return next; })} className="underline">Discard typed tracking changes</button>}</div>
        </form> : <div>{row.carrier && <p>Carrier: {row.carrier}</p>}{row.trackingNumber && <p className="break-all">Package tracking: {row.trackingNumber}</p>}{row.status === "PENDING" && <p>Fulfillment starts after the order is confirmed and card payment, if applicable, is verified.</p>}</div>}
        {role === "ADMIN" && (row.status === "SHIPPED" || (row.status === "DELIVERED" && row.paymentMethod === "COD" && row.paymentStatus !== "PAID")) && <div className="space-y-2 rounded border p-3">
          {row.paymentMethod === "COD" && <label className="flex items-start gap-2"><input type="checkbox" checked={collections[row.id] === row.version} disabled={busy || needsReload[row.id]} onChange={(event) => setCollections((value) => { const next = { ...value }; if (event.target.checked) next[row.id] = row.version; else delete next[row.id]; return next; })} />I confirm that the COD money for this shipment has been received.</label>}
          <button type="button" disabled={busy || needsReload[row.id] || !!draft || (row.paymentMethod === "COD" && collections[row.id] !== row.version)} onClick={() => void save(row, row.status === "DELIVERED" ? "collect-cod" : "deliver")} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{row.status === "DELIVERED" ? "Record received COD money" : "Confirm shipment delivered"}</button>
          {draft && <p>Save or discard typed tracking changes before confirming delivery.</p>}
          {row.paymentMethod === "COD" && <p className="text-sm">The whole order is paid only after COD receipt is confirmed for every shipment.</p>}
        </div>}
        {row.codCollectedAt && <p className="text-sm">COD money received: <time dateTime={row.codCollectedAt}>{new Date(row.codCollectedAt).toLocaleString("en-BD")}</time></p>}
        <button type="button" disabled={busy} onClick={() => void loadHistory(row)} className="text-sm underline">{history ? "Reload shipment history" : "Show shipment history"}</button>
        {history && <div className="space-y-2 text-sm"><ol className="space-y-2">{history.events.map((event) => <li key={event.id}><strong>{event.kind === "LEGACY_SNAPSHOT" ? "Earlier status snapshot" : event.kind === "SHIPMENT_UPDATED" ? "Tracking details updated" : fulfillmentStatusLabel(event.status)}</strong>{event.actorRole && <span> · {event.actorRole === "ADMIN" ? "Administrator" : "Seller"}</span>}<p>{event.occurredAt ? new Date(event.occurredAt).toLocaleString("en-BD") : `Transition time not recorded; snapshot recorded ${new Date(event.recordedAt).toLocaleString("en-BD")}`}</p>{event.carrier && <p>{event.carrier} / {event.trackingNumber}</p>}</li>)}</ol>{history.nextCursor && <button type="button" disabled={busy} onClick={() => void loadHistory(row, true)} className="underline">Load earlier history continuation</button>}</div>}
      </article>;
    })}
    {data && <nav aria-label="Shipment pages" className="flex gap-3"><button type="button" disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-2 disabled:opacity-50">Previous page</button><button type="button" disabled={busy || page >= data.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-2 disabled:opacity-50">Next page</button></nav>}
  </section>;
}
