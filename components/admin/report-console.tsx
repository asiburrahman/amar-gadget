"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import type { AdministratorReport } from "@/lib/admin-reporting";
type Filters = { from: string; to: string; status: string; paymentStatus: string; paymentMethod: string; customerId: string };
const initial = (): Filters => ({ from: "", to: "", status: "ALL", paymentStatus: "ALL", paymentMethod: "ALL", customerId: "" });
const fields = (report: AdministratorReport): Filters => ({ from: report.filters.from, to: report.filters.to, status: report.filters.status, paymentStatus: report.filters.paymentStatus, paymentMethod: report.filters.paymentMethod, customerId: report.filters.customerId ?? "" });
const style = "rounded border p-2";
export function reportMoney(cents: number) { const value = BigInt(cents); return `BDT ${new Intl.NumberFormat("en-BD").format(value / BigInt(100))}.${String(value % BigInt(100)).padStart(2, "0")}`; }
function ReportWorkspace({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<AdministratorReport | null>(null), [draft, setDraft] = useState<Filters>(initial), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const live = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>());
  const current = () => live.current && useAuthStore.getState().user?.id === ownerId && useAuthStore.getState().user?.role === "ADMIN";
  useEffect(() => { live.current = true; const active = controllers.current; return () => { live.current = false; for (const controller of active) controller.abort(); active.clear(); }; }, []);
  async function load(filters: Filters, page = 1, csv = false) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); setMessage("");
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const params = new URLSearchParams({ status: filters.status, paymentStatus: filters.paymentStatus, paymentMethod: filters.paymentMethod, page: String(csv ? 1 : page), format: csv ? "csv" : "json", ...(filters.from || filters.to ? { from: filters.from, to: filters.to } : {}), ...(filters.customerId.trim() ? { customerId: filters.customerId.trim() } : {}) });
      const response = await fetch(`/api/admin/reports?${params}`, { cache: "no-store", headers: { "X-Reports-Owner": ownerId }, signal: controller.signal });
      if (!response.ok) { const value = await response.json().catch(() => null); throw new Error(value?.message || "The report could not be confirmed."); }
      if (!current() || controller.signal.aborted) return;
      if (csv) {
        if (!response.headers.get("content-type")?.startsWith("text/csv")) throw new Error("The CSV export could not be confirmed.");
        const file = await response.blob(); if (!current() || controller.signal.aborted) return; if (file.size > 5 * 1024 * 1024) throw new Error("The export is too large. Narrow the filters.");
        const url = URL.createObjectURL(file), anchor = document.createElement("a"); anchor.href = url; anchor.download = `amar-gadget-orders-${filters.from}-${filters.to}.csv`; document.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        setMessage("CSV downloaded using the displayed filters and a fresh database snapshot. Each row records its export time.");
      } else {
        const value = await response.json(); if (!current() || controller.signal.aborted) return;
        if (!value.success || value.ownerId !== ownerId || !Array.isArray(value.rows) || value.page !== page || !value.summary || !value.filters) throw new Error("The report owner, filters or page changed. Reload this area.");
        setData(value); setDraft(fields(value));
      }
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Reports are temporarily unavailable."); }
    finally { clearTimeout(timeout); controllers.current.delete(controller); working.current = false; if (current()) setBusy(false); }
  }
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(initial()); }); return () => { cancelled = true; };
    // The authenticated owner lifetime is keyed by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = data ? JSON.stringify(draft) !== JSON.stringify(fields(data)) : true;
  const change = (key: keyof Filters, value: string) => setDraft((prior) => ({ ...prior, [key]: value }));
  return <section className="space-y-5"><nav className="flex gap-4"><Link className="underline" href="/admin/analytics">All-time analytics</Link><Link className="underline" href="/admin/users">All accounts</Link><Link className="underline" href="/admin/members">Seller members</Link></nav>
    <p>Filters select the order placement date in Asia/Dhaka, including both dates. Refunds and disputes reflect current confirmed facts for that cohort, rather than transfers that happened within those dates. New reports default to the latest 30 calendar days.</p>
    <form className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); void load(draft); }}><fieldset className="grid gap-3 sm:grid-cols-3" disabled={busy}><label>From (Dhaka date) <input className={`${style} w-full`} type="date" min="2000-01-01" value={draft.from} onChange={(event) => change("from", event.target.value)} /></label><label>To (Dhaka date) <input className={`${style} w-full`} type="date" min="2000-01-01" value={draft.to} onChange={(event) => change("to", event.target.value)} /></label><label>Order status <select className={`${style} w-full`} value={draft.status} onChange={(event) => change("status", event.target.value)}>{["ALL", "PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Payment status <select className={`${style} w-full`} value={draft.paymentStatus} onChange={(event) => change("paymentStatus", event.target.value)}>{["ALL", "UNPAID", "PAID", "FAILED"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Payment method <select className={`${style} w-full`} value={draft.paymentMethod} onChange={(event) => change("paymentMethod", event.target.value)}>{["ALL", "COD", "STRIPE"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Customer account ID (optional) <input className={`${style} w-full`} maxLength={36} value={draft.customerId} onChange={(event) => change("customerId", event.target.value)} /></label></fieldset><p>Use both dates with a maximum inclusive range of 366 days.</p><button className={style} disabled={busy} type="submit">Apply report filters</button> <button className={style} disabled={busy || !data || dirty} type="button" onClick={() => data && void load(fields(data), 1, true)}>Export displayed filters as CSV</button>{dirty && data && <p>Apply your edited filters before exporting. The saved report below still uses its displayed range.</p>}</form>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}{busy && <p role="status">Loading the actual report…</p>}
    {data && <><p>Displayed cohort: {data.filters.from} through {data.filters.to} ({data.timezone}); status {data.filters.status}, payment {data.filters.paymentStatus}, method {data.filters.paymentMethod}, customer {data.filters.customerId ?? "all"}. Snapshot generated {data.asOf}.</p><dl className="grid gap-3 sm:grid-cols-3">{[
      ["Orders placed", String(data.summary.orders)], ["Gross order book", reportMoney(data.summary.grossOrderCents)], ["Fully paid capture", reportMoney(data.summary.paidCaptureCents)], ["Paid-order confirmed refunds", reportMoney(data.summary.paidRefundCents)], ["Paid-order lost disputes", reportMoney(data.summary.lostDisputeCents)], ["Net fully collected", reportMoney(data.summary.netFullyCollectedCents)], ["Partially collected COD orders", String(data.summary.partiallyCollectedCodOrders)], ["Orders requiring financial review", String(data.summary.reviewOrders)],
    ].map(([label, value]) => <div className="rounded border p-3" key={label}><dt>{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}</dl>
      <p>Gross order book includes unpaid and cancelled orders and includes shipping. Net fully collected is paid capture less confirmed refunds and lost dispute principal, floored at zero per order. Partially collected COD is identified separately. These amounts are not seller commission or payout availability.</p>
      <div className="overflow-auto"><table className="w-full text-left"><caption>Matching orders ({data.summary.orders})</caption><thead><tr>{["Order / customer", "Placed (UTC)", "Order status", "Payment", "Order total", "Confirmed refunds", "Lost dispute", "Net collected", "Collected COD shipments", "Review"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-2"><p>{row.id}</p><small>{row.userId}</small></td><td>{row.createdAt}</td><td>{row.status}</td><td>{row.paymentMethod} / {row.paymentStatus}</td><td>{reportMoney(row.totalCents)}</td><td>{reportMoney(row.refundedCents)}</td><td>{reportMoney(row.lostDisputeCents)}</td><td>{row.netCents === null ? "Not fully paid" : reportMoney(row.netCents)}</td><td>{row.collectedShipments}</td><td>{row.review ? "Required" : "Clear"}</td></tr>)}</tbody></table></div>{!data.rows.length && <p>No orders match these filters.</p>}<button className={style} disabled={busy || data.page <= 1} onClick={() => void load(fields(data), data.page - 1)}>Previous report page</button> <span>Page {data.page} / {data.totalPages}</span> <button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load(fields(data), data.page + 1)}>Next report page</button>
      <div className="overflow-auto"><table className="w-full text-left"><caption>Days with matching orders (Dhaka placement dates)</caption><thead><tr>{["Day", "Orders", "Gross order book", "Paid capture", "Confirmed refunds", "Lost disputes", "Net fully collected", "Partial COD", "Review"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.daily.map((row) => <tr className="border-t" key={row.day}><td className="p-2">{row.day}</td><td>{row.orders}</td><td>{reportMoney(row.grossOrderCents)}</td><td>{reportMoney(row.paidCaptureCents)}</td><td>{reportMoney(row.paidRefundCents)}</td><td>{reportMoney(row.lostDisputeCents)}</td><td>{reportMoney(row.netFullyCollectedCents)}</td><td>{row.partiallyCollectedCodOrders}</td><td>{row.reviewOrders}</td></tr>)}</tbody></table></div><p>CSV includes every matching order up to 5,000, with UTC timestamps, BDT money, current review facts and the applied Dhaka date range. Larger exports require narrower filters; no partial export is silently substituted.</p>
    </>}
  </section>;
}
export function ReportConsole({ ownerId }: { ownerId: string }) {
  const user = useAuthStore((state) => state.user); if (user?.id !== ownerId || user.role !== "ADMIN") return <p role="status">Confirm your administrator session to load reports.</p>;
  return <ReportWorkspace key={ownerId} ownerId={ownerId} />;
}
