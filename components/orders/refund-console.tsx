"use client";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRefundConsole, type RefundPreview } from "@/hooks/use-refund-console";
import { formatCurrency } from "@/lib/formatter";
import type { RefundAction } from "@/lib/validations/refund";

const money = (value: number) => formatCurrency(value / 100);
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const inputClass = "block w-full rounded border bg-background p-2";
const buttonClass = "rounded border px-3 py-2 disabled:opacity-50";
function minorUnits(value: string) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a nonnegative BDT amount with at most two decimal places.");
  const [whole, fraction = ""] = value.split("."); return Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")));
}
type CodDraft = { method: "CASH" | "BKASH" | "NAGAD" | "BANK" | "OTHER"; reference: string; confirmedVersion: number | null };
type ReturnDraft = { quantity: number; confirmedVersion: number | null };
type AllocationDraft = { shipping: string; lines: Record<string, { quantity: number; amount: string }> };
export function RefundConsole({ orderId, admin = false }: { orderId: string; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading account...</p>;
  if (!user || (admin && user.role !== "ADMIN")) return <p>Sign in with the matching account to view order refunds.</p>;
  return <OwnedRefundConsole key={`${user.id}:${user.role}:${orderId}:${admin}`} ownerId={user.id} ownerRole={user.role} orderId={orderId} admin={admin} />;
}
function OwnedRefundConsole({ ownerId, ownerRole, orderId, admin }: { ownerId: string; ownerRole: string; orderId: string; admin: boolean }) {
  const api = useRefundConsole(ownerId, ownerRole, orderId, admin);
  const [scope, setScope] = useState<"FULL" | "ITEMS">("FULL"), [quantities, setQuantities] = useState<Record<string, number>>({}), [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RefundPreview | null>(null), [formError, setFormError] = useState(""), [shipping, setShipping] = useState("0");
  const [notes, setNotes] = useState<Record<string, string>>({}), [cod, setCod] = useState<Record<string, CodDraft>>({}), [returns, setReturns] = useState<Record<string, ReturnDraft>>({}), [allocations, setAllocations] = useState<Record<string, AllocationDraft>>({});
  const { data } = api, disabled = api.busy || api.needsReload || !!api.pending;
  const note = (key: string, value: string) => setNotes((saved) => ({ ...saved, [key]: value }));
  const clearRecordedDraft = (action: RefundAction) => {
    if (action.action === "request") { setPreview(null); setReason(""); setQuantities({}); }
    if (action.action === "return") { setReturns((saved) => { const next = { ...saved }; delete next[action.itemId]; return next; }); note(`return-${action.itemId}`, ""); }
    if (action.action === "confirm-cod") setCod((saved) => { const next = { ...saved }; delete next[action.refundId]; return next; });
  };
  const perform = async (action: RefundAction) => {
    setFormError(""); const result = await api.mutate(action);
    if (result && "saved" in result) clearRecordedDraft(action);
    return result;
  };
  const reload = async () => { const recorded = await api.load(); if (recorded) clearRecordedDraft(recorded); setPreview(null); };
  const selection = () => scope === "FULL" ? "FULL" as const : Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  return <section aria-label="Order refunds and returns" className="space-y-4 rounded border p-4">
    <h3 className="text-lg font-bold">Refunds and returns</h3>
    <button type="button" disabled={api.busy} onClick={() => void reload()} className={buttonClass}>Reload saved financial state</button>
    {api.busy && <p role="status">Loading or reconciling financial state...</p>}{api.message && <p role="status">{api.message}</p>}{(api.error || formError) && <p role="alert" className="text-destructive">{api.error || formError}</p>}
    {api.needsReload && <p>Reload the saved state before another change. Your typed details have been retained.</p>}
    {api.pending && <div className="space-y-2 rounded border p-3"><p>The original attempt was not confirmed. Reload to find its saved receipt, or retry the same attempt after a successful reload.</p><button type="button" disabled={api.busy || !api.canRetry} onClick={async () => { const recorded = await api.retry(); if (recorded) clearRecordedDraft(recorded); }} className={buttonClass}>Retry the original attempt</button><button type="button" disabled={api.busy || !api.readConfirmed || api.needsReload} onClick={() => { api.discard(); setPreview(null); }} className={buttonClass}>Discard the unrecorded draft</button></div>}
    {data && <>
      <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt>Original order amount</dt><dd>{money(data.order.totalCents)}</dd></div><div><dt>Confirmed refunds</dt><dd>{money(data.order.refundedCents)}</dd></div><div><dt>Refund status</dt><dd>{label(data.order.refundState)}</dd></div><div><dt>Dispute status</dt><dd>{label(data.order.disputeStatus)}</dd></div></dl>
      {data.order.refundState === "REVIEW" && <p>Financial reconciliation is required. Recorded transfer amounts and current statuses remain visible below.</p>}
      {admin && data.order.reviewReason && <p>Review: {label(data.order.reviewReason)}</p>}
      {data.disputes.map((dispute, index) => <p key={dispute.id || index}>Provider dispute: {label(dispute.status)}; disputed amount {money(dispute.amountCents)}; confirmed loss {money(dispute.fundsLostCents)}.</p>)}
      {admin && !data.order.pricing && <form className="space-y-2 rounded border p-3" onSubmit={(event) => { event.preventDefault(); try { void perform({ action: "pricing", orderId, version: data.order.version, shippingCents: minorUnits(shipping), evidence: notes.pricing || "" }); } catch (error) { setFormError(error instanceof Error ? error.message : "Check the pricing fields."); } }}>
        <h4 className="font-semibold">Reconcile historical purchase pricing</h4><p>Verify the original shipping charge from the purchase record. The saved item prices and order amount determine the discount; current catalog prices are not used.</p>
        <label>Verified shipping charge (BDT)<input aria-label="Verified shipping charge (BDT)" inputMode="decimal" value={shipping} disabled={disabled} onChange={(event) => setShipping(event.target.value)} className={inputClass} required /></label>
        <label>Purchase evidence/reference<textarea aria-label="Purchase evidence/reference" required minLength={5} maxLength={500} disabled={disabled} value={notes.pricing || ""} onChange={(event) => note("pricing", event.target.value)} className={inputClass} /></label>
        <button disabled={disabled} className={buttonClass}>Save verified purchase pricing</button>
      </form>}
      {admin && data.order.reviewReason === "PROVIDER_REFUND_REVERSED" && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void perform({ action: "resolve-review", orderId, version: data.order.version, evidence: notes.reversal || "" }); }}><p>A previously completed provider refund failed or was reversed. Verify its current outcome before approving a replacement attempt. Returned/voided inventory is preserved.</p><label>Provider reversal review evidence<textarea required minLength={5} maxLength={500} disabled={disabled} value={notes.reversal || ""} onChange={(event) => note("reversal", event.target.value)} className={inputClass} /></label><button disabled={disabled} className={buttonClass}>Record completed reversal review</button></form>}
      {admin && data.order.pricing && <form className="space-y-3 rounded border p-3" onSubmit={(event) => { event.preventDefault(); if (!preview || preview.version !== data.order.version) return; const body: RefundAction = { action: "request", request: { orderId, version: preview.version, requestId: crypto.randomUUID(), reason, selection: selection() } }; setPreview(null); void perform(body); }}>
        <h4 className="font-semibold">Request a refund</h4>
        <label>Refund scope<select aria-label="Refund scope" value={scope} disabled={disabled} onChange={(event) => { setScope(event.target.value as "FULL" | "ITEMS"); setPreview(null); }} className={inputClass}><option value="FULL">All remaining paid items</option><option value="ITEMS">Selected item quantities</option></select></label>
        {scope === "ITEMS" && data.items.map((item) => <label key={item.id} className="block">{item.name}: quantity to refund ({item.quantity - item.refundedQuantity} remaining)<input aria-label={`Refund quantity for ${item.name}`} type="number" min={0} max={Math.min(100, item.quantity - item.refundedQuantity)} step={1} disabled={disabled} value={quantities[item.id] ?? 0} onChange={(event) => { setQuantities((saved) => ({ ...saved, [item.id]: Number(event.target.value) })); setPreview(null); }} className={inputClass} /></label>)}
        <label>Refund reason<textarea aria-label="Refund reason" required minLength={5} maxLength={500} value={reason} disabled={disabled} onChange={(event) => setReason(event.target.value)} className={inputClass} /></label>
        <button type="button" disabled={disabled} onClick={async () => { const result = await perform({ action: "quote", request: { orderId, version: data.order.version, selection: selection() } }); if (result && "quote" in result) setPreview(result); }} className={buttonClass}>Preview refund amount</button>
        {preview && preview.version === data.order.version && <div className="space-y-2"><p>Refund amount: <strong>{money(preview.quote.amountCents)}</strong>; included shipping: {money(preview.quote.shippingCents)}.</p><ul>{preview.quote.lines.map((line) => <li key={line.itemId}>{data.items.find((item) => item.id === line.itemId)?.name}: {line.quantity} units, {money(line.amountCents)}</li>)}</ul><button disabled={disabled || reason.trim().length < 5} className={buttonClass}>Request the previewed refund</button></div>}
        <p className="text-sm">Shipping is refunded proportionately for undispatched goods. Dispatched goods exclude shipping. Card requests are processed through Stripe; COD requests wait for recorded external repayment.</p>
      </form>}
      {data.refunds.length === 0 && <p>No refund has been recorded for this order.</p>}
      {data.refunds.map((refund) => {
        const payment = cod[refund.id] || { method: "BKASH" as const, reference: "", confirmedVersion: null };
        const allocation = allocations[refund.id] || { shipping: "0", lines: {} };
        const changeAllocation = (itemId: string, value: { quantity?: number; amount?: string }) => setAllocations((saved) => ({ ...saved, [refund.id]: { ...allocation, lines: { ...allocation.lines, [itemId]: { quantity: allocation.lines[itemId]?.quantity ?? 0, amount: allocation.lines[itemId]?.amount ?? "0", ...value } } } }));
        return <article key={refund.id} className="space-y-2 rounded border p-3">
          <h4 className="font-semibold">{money(refund.amountCents)} — {label(refund.status)}</h4><p>{new Date(refund.createdAt).toLocaleString("en-BD")} · {refund.paymentMethod} · Shipping {money(refund.shippingCents)}</p>
          <ul>{refund.lines.map((line) => <li key={line.itemId}>{data.items.find((item) => item.id === line.itemId)?.name}: {line.quantity} units, {money(line.amountCents)}</li>)}</ul>
          {admin && <><p>{refund.reason}</p>{refund.providerRefundId && <p className="break-all">Stripe reference: {refund.providerRefundId} · {refund.providerStatus}</p>}{refund.errorCode && <p>Reconciliation: {label(refund.errorCode)}</p>}{refund.manualReference && <p className="break-all">External repayment: {refund.manualMethod} · {refund.manualReference}</p>}</>}
          {admin && refund.paymentMethod === "STRIPE" && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(refund.status) && <button type="button" disabled={disabled} onClick={() => void perform({ action: "process", refundId: refund.id, version: refund.version })} className={buttonClass}>Process/reconcile with Stripe</button>}
          {admin && refund.paymentMethod === "COD" && refund.status === "QUEUED" && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (payment.confirmedVersion !== refund.version) return; void perform({ action: "confirm-cod", refundId: refund.id, version: refund.version, moneyReturned: true, method: payment.method, reference: payment.reference }); }}>
            <p>Record money already returned outside this application. This form does not send a payment.</p>
            <label>Repayment method<select aria-label={`Repayment method for ${refund.id}`} disabled={disabled} value={payment.method} onChange={(event) => setCod((saved) => ({ ...saved, [refund.id]: { ...payment, method: event.target.value as CodDraft["method"], confirmedVersion: null } }))} className={inputClass}>{["CASH", "BKASH", "NAGAD", "BANK", "OTHER"].map((method) => <option key={method}>{method}</option>)}</select></label>
            <label>Transaction/receipt reference<input aria-label={`Transaction/receipt reference for ${refund.id}`} required minLength={3} maxLength={120} disabled={disabled} value={payment.reference} onChange={(event) => setCod((saved) => ({ ...saved, [refund.id]: { ...payment, reference: event.target.value, confirmedVersion: null } }))} className={inputClass} /></label>
            <label className="flex gap-2"><input type="checkbox" disabled={disabled} checked={payment.confirmedVersion === refund.version} onChange={(event) => setCod((saved) => ({ ...saved, [refund.id]: { ...payment, confirmedVersion: event.target.checked ? refund.version : null } }))} />I confirm this refund amount was actually returned to the customer.</label>
            <button disabled={disabled || payment.confirmedVersion !== refund.version || payment.reference.trim().length < 3} className={buttonClass}>Record external COD repayment</button>
          </form>}
          {admin && ["QUEUED", "REVIEW"].includes(refund.status) && !refund.submittedAt && !refund.providerRefundId && refund.kind !== "EXTERNAL" && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void perform({ action: "cancel-request", refundId: refund.id, version: refund.version, reason: notes[refund.id] || "" }); }}><label>Reason to cancel this unsubmitted request<textarea required minLength={5} maxLength={500} disabled={disabled} value={notes[refund.id] || ""} onChange={(event) => note(refund.id, event.target.value)} className={inputClass} /></label><button disabled={disabled} className={buttonClass}>Cancel unsubmitted refund request</button></form>}
          {admin && refund.canRecoverMissing && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void perform({ action: "recover-missing", refundId: refund.id, version: refund.version, evidence: notes[refund.id] || "" }); }}><label>Provider recovery evidence<textarea required minLength={5} maxLength={500} disabled={disabled} value={notes[refund.id] || ""} onChange={(event) => note(refund.id, event.target.value)} className={inputClass} /></label><button disabled={disabled} className={buttonClass}>Check provider history and resolve the missing attempt</button></form>}
          {admin && refund.kind === "EXTERNAL" && refund.status === "SUCCEEDED" && !refund.allocationConfirmed && data.order.pricing && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); try { const lines = data.items.map((item) => ({ itemId: item.id, quantity: allocation.lines[item.id]?.quantity ?? 0, amountCents: minorUnits(allocation.lines[item.id]?.amount || "0") })).filter((line) => line.quantity || line.amountCents); void perform({ action: "allocate-external", refundId: refund.id, version: refund.version, evidence: notes[refund.id] || "", shippingCents: minorUnits(allocation.shipping), lines }); } catch (error) { setFormError(error instanceof Error ? error.message : "Check the allocation amounts."); } }}>
            <h5 className="font-semibold">Attribute the provider&apos;s actual external refund</h5><p>This records money already returned. Enter the actual item and shipping allocation, supported by the provider record.</p>
            {data.items.map((item) => <div key={item.id} className="grid gap-2 sm:grid-cols-2"><label>{item.name}: refunded units<input type="number" min={0} max={item.quantity - item.refundedQuantity} step={1} disabled={disabled} value={allocation.lines[item.id]?.quantity ?? 0} onChange={(event) => changeAllocation(item.id, { quantity: Number(event.target.value) })} className={inputClass} /></label><label>{item.name}: refunded amount (BDT)<input inputMode="decimal" disabled={disabled} value={allocation.lines[item.id]?.amount || "0"} onChange={(event) => changeAllocation(item.id, { amount: event.target.value })} className={inputClass} /></label></div>)}
            <label>Actual shipping refund (BDT)<input inputMode="decimal" disabled={disabled} value={allocation.shipping} onChange={(event) => setAllocations((saved) => ({ ...saved, [refund.id]: { ...allocation, shipping: event.target.value } }))} className={inputClass} /></label>
            <label>Allocation evidence/reference<textarea required minLength={5} maxLength={500} disabled={disabled} value={notes[refund.id] || ""} onChange={(event) => note(refund.id, event.target.value)} className={inputClass} /></label><button disabled={disabled} className={buttonClass}>Save actual external allocation</button>
          </form>}
        </article>;
      })}
      {admin && data.items.filter((item) => ["SHIPPED", "DELIVERED"].includes(item.status) && item.quantity > item.voidedQuantity + item.returnedQuantity).map((item) => {
        const draft = returns[item.id] || { quantity: 1, confirmedVersion: null };
        return <form key={item.id} className="space-y-2 rounded border p-3" onSubmit={(event) => { event.preventDefault(); if (draft.confirmedVersion !== item.version) return; void perform({ action: "return", orderId, itemId: item.id, version: item.version, requestId: crypto.randomUUID(), quantity: draft.quantity, inspectedAndAccepted: true, evidence: notes[`return-${item.id}`] || "" }); }}>
          <h4 className="font-semibold">Receive returned stock: {item.name}</h4><p>{item.returnedQuantity} units already received; {item.quantity - item.voidedQuantity - item.returnedQuantity} can still be received.</p>
          <label>Inspected return quantity<input type="number" min={1} max={Math.min(100, item.quantity - item.voidedQuantity - item.returnedQuantity)} step={1} disabled={disabled} value={draft.quantity} onChange={(event) => setReturns((saved) => ({ ...saved, [item.id]: { quantity: Number(event.target.value), confirmedVersion: null } }))} className={inputClass} required /></label>
          <label>Return receipt and inspection evidence<textarea required minLength={5} maxLength={500} disabled={disabled} value={notes[`return-${item.id}`] || ""} onChange={(event) => { note(`return-${item.id}`, event.target.value); setReturns((saved) => ({ ...saved, [item.id]: { ...draft, confirmedVersion: null } })); }} className={inputClass} /></label>
          <label className="flex gap-2"><input type="checkbox" disabled={disabled} checked={draft.confirmedVersion === item.version} onChange={(event) => setReturns((saved) => ({ ...saved, [item.id]: { ...draft, confirmedVersion: event.target.checked ? item.version : null } }))} />I physically received and inspected these units and accepted them for restocking.</label>
          <button disabled={disabled || draft.confirmedVersion !== item.version} className={buttonClass}>Record inspected return and restock</button>
        </form>;
      })}
      <nav aria-label="Refund pages" className="flex items-center gap-3"><button type="button" disabled={disabled || api.page <= 1} onClick={() => api.setPage(api.page - 1)} className={buttonClass}>Previous refunds</button><span>{data.total} refunds · Page {data.page} of {data.totalPages}</span><button type="button" disabled={disabled || api.page >= data.totalPages} onClick={() => api.setPage(api.page + 1)} className={buttonClass}>Next refunds</button></nav>
      <h4 className="font-semibold">Financial history</h4><ol className="space-y-2 text-sm">{data.history.map((event) => <li key={event.id}>{label(event.kind)}{event.status ? ` · ${label(event.status)}` : ""}{event.amountCents !== null ? ` · ${money(event.amountCents)}` : ""}<p>{new Date(event.createdAt).toLocaleString("en-BD")}</p>{admin && event.evidence && <p>{event.evidence}</p>}</li>)}</ol>{data.nextCursor && <button type="button" disabled={disabled} onClick={() => void api.load(true)} className={buttonClass}>Load more financial history</button>}
    </>}
  </section>;
}

export function RefundDetails({ orderId, admin = false }: { orderId: string; admin?: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-3" onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-primary">{admin ? "Manage refunds and returns" : "View refunds and returns"}</summary>{open && <RefundConsole orderId={orderId} admin={admin} />}</details>;
}
