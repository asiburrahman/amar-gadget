"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { settlementMutationSchema, parseCommissionPercent, type SettlementMutation, type SettlementRequest } from "@/lib/validations/settlement";
import { parseSettlementAmount, settlementMoney, settlementPercent } from "@/lib/settlement-display";
import type { SellerSettlementView } from "@/lib/seller-settlement";
import { SettlementTables, type SettlementDecision } from "./settlement-tables";
type Mode = SellerSettlementView["mode"];
type Props = { ownerId: string; ownerRole: "ADMIN" | "MEMBER"; initialMode?: Mode };
const styles = "rounded border px-3 py-2", modes: [Mode, string][] = [["overview", "Overview / analytics"], ["shipments", "Shipment earnings"], ["ledger", "Ledger"], ["payouts", "Payouts"], ["policies", "Commercial policies"]];
function Workspace({ ownerId, ownerRole, initialMode = "overview" }: Props) {
  const router = useRouter(), admin = ownerRole === "ADMIN", storageKey = `amar:settlement-intent:${ownerId}`;
  const [data, setData] = useState<SellerSettlementView | null>(null), [mode, setMode] = useState<Mode>(initialMode), [sellerInput, setSellerInput] = useState(""), [scopeSeller, setScopeSeller] = useState("");
  const [decision, setDecision] = useState<SettlementDecision | null>(null), [percentage, setPercentage] = useState(""), [shipping, setShipping] = useState(""), [inherit, setInherit] = useState(false);
  const [amount, setAmount] = useState(""), [method, setMethod] = useState(""), [reference, setReference] = useState(""), [reason, setReason] = useState(""), [affirmed, setAffirmed] = useState(false), [noMoneySent, setNoMoneySent] = useState(false);
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [storageFault, setStorageFault] = useState(false), [pending, setPending] = useState<SettlementMutation | null>(null), [resolveAffirmed, setResolveAffirmed] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [loadedAt, setLoadedAt] = useState("");
  const active = useRef(false), working = useRef(false), original = useRef<SettlementMutation | null>(null), controllers = useRef(new Set<AbortController>());
  const current = () => { const user = useAuthStore.getState().user; return active.current && user?.id === ownerId && user.role === ownerRole && (ownerRole === "ADMIN" || user.sellerStatus === "APPROVED"); };
  useEffect(() => { active.current = true; const requests = controllers.current; return () => { active.current = false; for (const controller of requests) controller.abort(); requests.clear(); }; }, []);
  async function request(query = "", body?: SettlementRequest) {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`/api/settlements${query}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Settlement-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value: Record<string, unknown> = await response.json();
      if (!current() || controller.signal.aborted) throw new Error("The active settlement account changed. Reload this page.");
      if (!response.ok || !value.success) throw new Error(typeof value.message === "string" ? value.message : "Settlement could not be confirmed.");
      if (value.ownerId !== ownerId) throw new Error("The settlement response belongs to another account. Reload this page."); return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  function clearOriginal() {
    sessionStorage.removeItem(storageKey);
    if (sessionStorage.getItem(storageKey) !== null) throw new Error("The original receipt is recorded but the local intent could not be cleared. Reload its receipt before another operation.");
    original.current = null; setPending(null); setResolveAffirmed(false);
  }
  function recorded(result: unknown) {
    const saved = result as { id?: string; version?: number; status?: string } | null;
    if (!saved?.id || !Number.isInteger(saved.version)) throw new Error("The financial receipt could not be confirmed. Resolve the original request before another operation.");
    clearOriginal(); setDecision(null); setAffirmed(false); setNoMoneySent(false);
    setMessage(saved.status === "ABANDONED" ? "The original request was stopped on the server before execution. A late retry cannot execute it." : "The original change is recorded. Review the reloaded saved state; a payout reservation alone does not confirm an external transfer.");
  }
  async function read(page = 1, nextMode = mode, nextSeller = scopeSeller) {
    const params = new URLSearchParams({ mode: nextMode, page: String(page), ...(nextSeller ? { sellerId: nextSeller } : {}), ...(original.current ? { requestId: original.current.requestId } : {}) });
    const value = await request(`?${params}`);
    if (value.mode !== nextMode || value.page !== page || !Array.isArray(value.rows) || !value.summary) throw new Error("The saved financial view could not be confirmed.");
    if (!original.current && (nextMode !== mode || nextSeller !== scopeSeller)) { setDecision(null); setAffirmed(false); }
    setData(value as unknown as SellerSettlementView); setMode(nextMode); setScopeSeller(nextSeller); setConfirmed(true); setLoadedAt(new Date().toISOString());
    if (original.current && value.attempt) recorded(value.attempt);
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The settlement request failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(page = 1, nextMode = mode, nextSeller = scopeSeller) { await run(async () => { setConfirmed(false); await read(page, nextMode, nextSeller); }); }
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !current()) return;
      if (admin) try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
          const saved = JSON.parse(stored), parsed = settlementMutationSchema.safeParse(saved.intent);
          if (saved.ownerId !== ownerId || saved.ownerRole !== ownerRole || !parsed.success) throw new Error("Invalid saved financial intent");
          original.current = parsed.data; setPending(parsed.data);
        }
      } catch { setStorageFault(true); setError("Saved financial request metadata is unavailable or invalid. New operations are blocked. Review server payout/policy history and recover the original request ID before starting another operation."); }
      void load(1, initialMode);
    });
    return () => { cancelled = true; };
    // The parent keys this workspace by the current authenticated owner/role.
    // A read reload must not reset the captured decision or exact pending intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = busy || !confirmed || !!pending || storageFault;
  function choose(next: SettlementDecision) {
    setDecision(next); setReason(""); setAffirmed(false); setNoMoneySent(false); setReference(""); setAmount(""); setMethod("");
    if (next.action === "save-policy") {
      const saved = data?.currentPolicy, effective = saved?.commissionBps !== null && saved ? saved : data?.effectivePolicy;
      setInherit(next.scope === "SELLER" && (!saved || saved.commissionBps === null));
      setPercentage(effective?.commissionBps == null ? "" : settlementPercent(effective.commissionBps)); setShipping(effective?.shippingRecipient ?? "");
    }
  }
  function buildIntent(): SettlementMutation {
    if (!decision) throw new Error("Review a saved operation first.");
    const identity = { requestId: crypto.randomUUID(), reason, confirmed: affirmed };
    let fields: unknown;
    if (decision.action === "save-policy") fields = { ...identity, action: decision.action, scope: decision.scope, sellerId: decision.sellerId, version: decision.version, terms: inherit ? null : { commissionBps: parseCommissionPercent(percentage), shippingRecipient: shipping } };
    else if (decision.action === "start-payout") fields = { ...identity, action: decision.action, sellerId: decision.sellerId, amountCents: parseSettlementAmount(amount), method };
    else if (decision.action === "adopt-policy") fields = { ...identity, action: decision.action, fulfillmentId: decision.fulfillmentId, policyId: decision.policyId, version: decision.version };
    else fields = { ...identity, action: decision.action, payoutId: decision.payoutId, version: decision.version, ...(decision.action === "confirm-payout" ? { reference } : { noMoneySent }) };
    const parsed = settlementMutationSchema.safeParse(fields); if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Review the saved financial decision, amount and confirmation."); return parsed.data;
  }
  async function save(retry?: SettlementMutation) {
    await run(async () => {
      if (!admin || storageFault || (!retry && (original.current || !confirmed))) return;
      const intent = retry ?? buildIntent();
      const stored = JSON.stringify({ ownerId, ownerRole, intent });
      try { sessionStorage.setItem(storageKey, stored); if (sessionStorage.getItem(storageKey) !== stored) throw new Error("Storage mismatch"); }
      catch { throw new Error("The exact financial request cannot be preserved in this tab. Enable session storage before submitting; no operation was sent."); }
      original.current = intent; setPending(intent); setConfirmed(false); setResolveAffirmed(false);
      const saved = await request("", intent); recorded(saved.result); await read(1); router.refresh();
    });
  }
  async function resolve() {
    await run(async () => {
      if (!admin || !original.current || !resolveAffirmed) return;
      setConfirmed(false); const saved = await request("", { action: "abandon-request", originalIntent: original.current, confirmed: true });
      recorded(saved.result); await read(1); router.refresh();
    });
  }
  const resetConfirmation = () => setAffirmed(false);
  return <section className="space-y-5">
    <nav className="flex flex-wrap gap-4">{admin ? <><Link className="underline" href="/admin/members">Seller members</Link><Link className="underline" href="/admin/reports">Order reports</Link></> : <><Link className="underline" href="/member/dashboard">Seller dashboard</Link><Link className="underline" href="/member/earnings">Earnings</Link><Link className="underline" href="/member/payouts">Payouts</Link><Link className="underline" href="/member/analytics">Settlement analytics</Link></>}</nav>
    <p>Commission and shipping allocation use captured administrator-configured terms. Delivered and collected shipments become available after financial holds clear. Actual refunds/disputes can reverse credits and create debt after payout.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    {storageFault && <p role="alert">Local request metadata needs recovery. You can inspect saved financial history, but this tab cannot start new financial operations.</p>}
    <div className="flex flex-wrap gap-3">{modes.map(([value, label]) => <button key={value} className={styles} disabled={busy} aria-pressed={mode === value} onClick={() => void load(1, value)}>{label}</button>)}</div>
    {admin && <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void load(1, mode, sellerInput.trim()); }}><label>Exact catalog owner ID (empty for all owners / global policy) <input className={styles} value={sellerInput} maxLength={64} disabled={busy} onChange={(event) => setSellerInput(event.target.value)} /></label><button className={styles} disabled={busy}>Apply owner scope</button></form>}
    <button className={styles} disabled={busy} onClick={() => void load(data?.page ?? 1)}>Reload saved settlement / original receipt</button>
    {pending && <div className="space-y-3 rounded border p-4"><h2 className="font-semibold">Unresolved original request</h2><p>Request ID: <code>{pending.requestId}</code>. Reload its receipt or retry this exact intent. Resolving without execution returns a committed result if it already exists; otherwise it stops this UUID on the server. It does not undo a committed payout or transfer.</p><details><summary>Original financial intent</summary><pre className="overflow-auto text-xs">{JSON.stringify(pending, null, 2)}</pre></details><button className={styles} disabled={busy || !confirmed} onClick={() => original.current && void save(original.current)}>Retry exact original request</button><label className="block"><input type="checkbox" checked={resolveAffirmed} disabled={busy} onChange={(event) => setResolveAffirmed(event.target.checked)} /> I confirm resolving this original request without executing a new operation.</label><button className={styles} disabled={busy || !resolveAffirmed} onClick={() => void resolve()}>Resolve original request on server</button></div>}
    {data && <><p>Saved scope: {data.seller ? `${data.seller.email} (${data.seller.id})` : "All catalog owners; global commercial policy"}. Loaded {loadedAt}. {!confirmed && "This view needs reconfirmation before another operation."}</p><dl className="grid gap-3 sm:grid-cols-3">{[["Available for new payouts", data.summary.payableCents], ["Seller debt / receivable", data.summary.receivableCents], ["Reserved external instructions", data.summary.reservedCents], ["Confirmed external payouts", data.summary.paidCents], ["Current posted entitlement", data.summary.entitlementCents], ["Potential under known terms", data.summary.potentialCents]].map(([label, value]) => <div className="rounded border p-3" key={label}><dt>{label}</dt><dd className="text-lg font-semibold">{settlementMoney(value)}</dd></div>)}</dl><p>{data.summary.heldShipments} held shipments; {data.summary.unconfiguredShipments} need commercial terms. Potential excludes unknown terms/pricing and is not a transferable balance. Payable and debt are separate per-owner totals.</p>
      <SettlementTables data={data} admin={admin} locked={locked} decide={choose} selectSeller={(id) => { setSellerInput(id); void load(1, "overview", id); }} />
      {!data.rows.length && <p>No saved records match this scope.</p>}<div className="flex flex-wrap gap-3"><button className={styles} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous settlement page</button><span>Page {data.page} / {data.totalPages}; {data.total} matching records</span><button className={styles} disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next settlement page</button></div>
    </>}
    {admin && decision && <form aria-label="Settlement operation" className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); if (!locked) void save(); }}><h2 className="text-xl font-semibold">Review {decision.action}</h2><fieldset className="space-y-3" disabled={busy || !!pending || storageFault}>
      {decision.action === "save-policy" && <><p>Captured decision: {decision.scope} {decision.sellerId ?? "policy"}; observed revision {decision.version}. Reloading this list does not replace your reviewed revision.</p>{decision.scope === "SELLER" && <label className="block"><input type="checkbox" checked={inherit} onChange={(event) => { setInherit(event.target.checked); resetConfirmation(); }} /> Inherit the current global policy for future purchases</label>}<label className="block">Commission percent <input className={styles} inputMode="decimal" maxLength={6} value={percentage} disabled={inherit} onChange={(event) => { setPercentage(event.target.value); resetConfirmation(); }} /></label><label className="block">Shipping recipient <select className={styles} value={shipping} disabled={inherit} onChange={(event) => { setShipping(event.target.value); resetConfirmation(); }}><option value="">Choose recipient</option><option value="SELLER">Seller</option><option value="PLATFORM">Platform</option></select></label><p>Commission applies to remaining discount-adjusted goods, excludes shipping and rounds half up per shipment. Shipping/refund shares follow captured original goods. Older captured purchases keep their commercial terms.</p></>}
      {decision.action === "start-payout" && <><p>Catalog owner {decision.sellerId}. Previously displayed available balance: {settlementMoney(decision.shownBalanceCents)}. The server checks current availability before reserving.</p><label className="block">Payout amount (BDT) <input className={styles} inputMode="decimal" maxLength={19} required value={amount} onChange={(event) => { setAmount(event.target.value); resetConfirmation(); }} /></label><label className="block">External payment method <input className={styles} minLength={2} maxLength={30} required value={method} onChange={(event) => { setMethod(event.target.value); resetConfirmation(); }} /></label><p>This reserves funds and creates an instruction. Send money externally only after reviewing its saved reservation, then record its actual reference.</p></>}
      {decision.action === "adopt-policy" && <p>Shipment {decision.fulfillmentId}; terms revision {decision.version}. Adopt reviewed policy {decision.policyId}: {settlementPercent(decision.commissionBps)}% commission; shipping to {decision.shippingRecipient}. This is a one-time decision for an existing unconfigured purchase, and may release eligible earnings immediately.</p>}
      {(decision.action === "confirm-payout" || decision.action === "cancel-payout") && <><p>Payout {decision.payoutId}, owner {decision.sellerId}, observed revision {decision.version}: {settlementMoney(decision.amountCents)} via {decision.method}.</p>{decision.action === "confirm-payout" ? <><label className="block">Actual external transaction reference <input className={styles} required minLength={3} maxLength={120} value={reference} onChange={(event) => { setReference(event.target.value); resetConfirmation(); }} /></label><p>Record this only after the external transfer actually occurred. Confirmation records the reserved amount and does not send another payment; intervening refunds may create seller debt.</p></> : <label className="block"><input type="checkbox" checked={noMoneySent} onChange={(event) => { setNoMoneySent(event.target.checked); resetConfirmation(); }} /> No money was sent for this payout. Release its reservation.</label>}</>}
      <label className="block">Operation reason <input className={`${styles} w-full`} required minLength={5} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); resetConfirmation(); }} /></label><label className="block"><input type="checkbox" checked={affirmed} onChange={(event) => setAffirmed(event.target.checked)} /> I confirm the displayed target, revision, amounts and this {decision.action} operation.</label>
      <button className={styles} type="submit" disabled={locked || !affirmed || reason.trim().length < 5 || (decision.action === "cancel-payout" && !noMoneySent)}>Confirm reviewed settlement operation</button>
    </fieldset></form>}
  </section>;
}
export function SettlementConsole(props: Props) {
  const { user, loading } = useAuth(); if (loading) return <p role="status">Loading settlement account...</p>;
  if (user?.id !== props.ownerId || user.role !== props.ownerRole || (user.role === "MEMBER" && user.sellerStatus !== "APPROVED")) return <p role="status">Reload with the matching approved settlement account.</p>;
  return <Workspace key={`${props.ownerId}:${props.ownerRole}:${props.initialMode ?? "overview"}`} {...props} />;
}
