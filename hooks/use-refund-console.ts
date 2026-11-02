"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import type { RefundAction } from "@/lib/validations/refund";
import type { RefundOrderView } from "@/lib/refunds";

type Attempt = Extract<RefundAction, { action: "request" | "return" }>;
export type RefundPreview = { version: number; quote: { amountCents: number; shippingCents: number; lines: { itemId: string; quantity: number; amountCents: number; beforeDispatch: boolean }[] } };
export function useRefundConsole(ownerId: string, ownerRole: string, orderId: string, admin: boolean) {
  const router = useRouter(), endpoint = admin ? "/api/admin/refunds" : "/api/user/refunds";
  const [data, setData] = useState<RefundOrderView | null>(null), [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [needsReload, setNeedsReload] = useState(false), [pending, setPending] = useState<Attempt | null>(null), [readConfirmed, setReadConfirmed] = useState(false);
  const live = useRef(false), working = useRef(false), epoch = useRef(0), requests = useRef(new Set<AbortController>()), attempt = useRef<Attempt | null>(null);
  const current = () => { const actor = useAuthStore.getState().user; return live.current && actor?.id === ownerId && actor.role === ownerRole && (!admin || actor.role === "ADMIN"); };
  useEffect(() => {
    live.current = true; const controllers = requests.current;
    const cancel = () => { live.current = false; epoch.current++; working.current = false; for (const controller of controllers) controller.abort(); controllers.clear(); };
    return cancel;
  }, []);
  const request = async (path: string, body?: RefundAction) => {
    const controller = new AbortController(); requests.current.add(controller); const deadline = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: { "X-Refund-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      const value = await response.json();
      if (controller.signal.aborted) throw new Error("The request timed out. Reload the saved financial state before retrying.");
      if (!response.ok || !value.success) throw new Error(typeof value.message === "string" ? value.message : "The financial request was not confirmed.");
      if (value.ownerId !== ownerId || (value.orderId ?? value.order?.id) !== orderId) throw new Error("The active account or order changed. Reload this view.");
      return value;
    } finally { clearTimeout(deadline); requests.current.delete(controller); }
  };
  const load = async (moreHistory = false): Promise<Attempt | null> => {
    if (!current() || working.current) return null;
    const ticket = ++epoch.current; working.current = true; setBusy(true); setError("");
    try {
      const pendingId = attempt.current?.action === "request" ? attempt.current.request.requestId : attempt.current?.requestId;
      const query = new URLSearchParams({ orderId, page: String(page), ...(pendingId ? { requestId: pendingId } : {}), ...(moreHistory && data?.nextCursor ? { cursor: data.nextCursor } : {}) });
      const saved: RefundOrderView = await request(`${endpoint}?${query}`);
      if (!current() || epoch.current !== ticket) return null;
      if (!Array.isArray(saved.refunds) || !Array.isArray(saved.items) || saved.page !== page || !Number.isInteger(saved.order.version)) throw new Error("The financial state could not be confirmed. Reload it.");
      setData((previous) => moreHistory && previous ? { ...saved, history: [...new Map([...previous.history, ...saved.history].map((event) => [event.id, event])).values()] } : saved);
      setNeedsReload(false); setReadConfirmed(true);
      const found = attempt.current?.action === "request" ? saved.attempt?.refund : attempt.current?.action === "return" ? saved.attempt?.returned : null;
      if (found) { const recorded = attempt.current; attempt.current = null; setPending(null); setMessage("The original attempt is already recorded in the saved history."); return recorded; }
    } catch (cause) { if (current() && epoch.current === ticket) { setNeedsReload(true); setReadConfirmed(false); setError(cause instanceof Error ? cause.message : "Unable to load financial state."); } }
    finally { if (epoch.current === ticket) { working.current = false; if (current()) setBusy(false); } }
    return null;
  };
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
    // Account, role and order lifetimes are keyed by the parent component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  const mutate = async (body: RefundAction, retry = false): Promise<RefundPreview | { saved: true } | null> => {
    if (!current() || working.current || (needsReload && !retry)) return null;
    if (attempt.current && !retry) return null;
    const ticket = ++epoch.current; working.current = true; setBusy(true); setError(""); setMessage("");
    if (body.action === "request" || body.action === "return") { attempt.current = body; setPending(body); setReadConfirmed(false); }
    let saved = false;
    try {
      const result = await request(endpoint, body);
      if (!current() || epoch.current !== ticket) return null;
      if (body.action === "quote") {
        if (result.version !== body.request.version || !Number.isSafeInteger(result.quote?.amountCents) || !Array.isArray(result.quote?.lines)) throw new Error("The refund preview was not confirmed. Reload the order.");
        return result;
      }
      attempt.current = null; setPending(null); setNeedsReload(false); setReadConfirmed(false);
      setMessage(body.action === "request" ? "Refund request recorded. Its transfer status is shown below." : body.action === "confirm-cod" ? "The confirmed external COD repayment was recorded." : body.action === "return" ? "Inspected returned units were recorded and restocked." : "Financial reconciliation saved.");
      saved = true;
    } catch (cause) { if (current() && epoch.current === ticket) { setNeedsReload(true); setReadConfirmed(false); setError(cause instanceof Error ? cause.message : "The financial change was not confirmed. Reload before retrying."); } }
    finally { if (epoch.current === ticket) { working.current = false; if (current()) setBusy(false); } }
    if (saved && current()) { await load(); if (current()) router.refresh(); }
    return saved && current() ? { saved: true } : null;
  };
  const canRetry = !!pending && !!data && readConfirmed && !needsReload && (pending.action === "request" ? data.order.version === pending.request.version : data.items.find((item) => item.id === pending.itemId)?.version === pending.version);
  const retry = async () => { if (canRetry && attempt.current) { const body = attempt.current; const result = await mutate(body, true); if (result && "saved" in result) return body; } return null; };
  const discard = () => { if (!busy && readConfirmed && !needsReload) { attempt.current = null; setPending(null); setMessage("Draft discarded. Saved financial history remains available below."); } };
  return { data, busy, error, message, needsReload, pending, readConfirmed, canRetry, page, setPage, load, mutate, retry, discard };
}
