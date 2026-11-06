"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import type { TaxonomyView } from "@/lib/catalog-taxonomy";
import type { TaxonomyMutation } from "@/lib/validations/taxonomy";
export type TaxonomyResult = { kind: "category" | "brand"; id: string; version: number; deleted: boolean };
const validResult = (value: TaxonomyResult | undefined, kind: string) => value?.kind === kind && typeof value.id === "string" && Number.isInteger(value.version) && value.version > 0 && typeof value.deleted === "boolean";
export function useTaxonomyConsole(ownerId: string, kind: "category" | "brand") {
  const router = useRouter(), [data, setData] = useState<TaxonomyView | null>(null), [page, setPage] = useState(1), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [needsReload, setNeedsReload] = useState(false), [readConfirmed, setReadConfirmed] = useState(false), [pending, setPending] = useState<TaxonomyMutation | null>(null);
  const live = useRef(false), working = useRef(false), epoch = useRef(0), controllers = useRef(new Set<AbortController>()), original = useRef<TaxonomyMutation | null>(null);
  const current = () => live.current && useAuthStore.getState().user?.id === ownerId && useAuthStore.getState().user?.role === "ADMIN";
  useEffect(() => { live.current = true; const active = controllers.current; const cancel = () => { live.current = false; working.current = false; epoch.current++; for (const item of active) item.abort(); active.clear(); }; return cancel; }, []);
  const request = async (queryString: string, body?: TaxonomyMutation): Promise<TaxonomyView & { result: TaxonomyResult }> => {
    const controller = new AbortController(); controllers.current.add(controller); const deadline = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`/api/admin/taxonomy${queryString}`, { method: body ? "POST" : "GET", cache: "no-store", headers: { "X-Taxonomy-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (controller.signal.aborted || !current()) throw new Error("The account or request changed. Reload the saved state.");
      if (!response.ok || !value.success) throw new Error(value.message || "The catalog operation was not confirmed.");
      if (value.ownerId !== ownerId || (body ? value.result?.kind : value.kind) !== kind) throw new Error("The catalog account or kind changed. Reload this view.");
      if (body && !validResult(value.result, kind)) throw new Error("The saved catalog receipt was not confirmed. Reload before retrying.");
      return value;
    } finally { clearTimeout(deadline); controllers.current.delete(controller); }
  };
  const read = async (options: Record<string, string>) => request(`?${new URLSearchParams({ kind, ...options })}`);
  const load = async (): Promise<TaxonomyResult | null> => {
    if (!current() || working.current) return null;
    const ticket = ++epoch.current; working.current = true; setBusy(true); setError("");
    try {
      const saved = await read({ page: String(page), q: query, ...(original.current ? { requestId: original.current.requestId } : {}) });
      if (!current() || ticket !== epoch.current) return null;
      if (!Array.isArray(saved.rows) || saved.page !== page) throw new Error("The catalog page could not be confirmed.");
      setData(saved); setNeedsReload(false); setReadConfirmed(true);
      if (original.current && saved.attempt) { const result = saved.attempt as unknown as TaxonomyResult; if (!validResult(result, kind)) throw new Error("The original receipt could not be confirmed."); original.current = null; setPending(null); setMessage("The original change is already recorded in the saved catalog."); return result; }
    } catch (cause) { if (current() && ticket === epoch.current) { setError(cause instanceof Error ? cause.message : "Unable to load catalog records."); setNeedsReload(true); setReadConfirmed(false); } }
    finally { if (ticket === epoch.current) { working.current = false; if (current()) setBusy(false); } }
    return null;
  };
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; };
    // The owner/kind lifetime is keyed by the parent. Filter changes reload only the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query]);
  const mutate = async (body: TaxonomyMutation, retry = false): Promise<TaxonomyResult | null> => {
    if (!current() || working.current || (needsReload && !retry) || (original.current && !retry)) return null;
    const ticket = ++epoch.current; working.current = true; setBusy(true); setError(""); setMessage(""); original.current = body; setPending(body); setReadConfirmed(false);
    let result: TaxonomyResult | null = null;
    try { const saved = await request("", body); if (!current() || ticket !== epoch.current) return null; result = saved.result; original.current = null; setPending(null); setNeedsReload(false); setMessage("Catalog change recorded. The storefront will use the saved values."); }
    catch (cause) { if (current() && ticket === epoch.current) { setError(cause instanceof Error ? cause.message : "The change was not confirmed."); setNeedsReload(true); setReadConfirmed(false); } }
    finally { if (ticket === epoch.current) { working.current = false; if (current()) setBusy(false); } }
    if (result && current()) { await load(); if (current()) router.refresh(); }
    return current() ? result : null;
  };
  const canRetry = !!pending && readConfirmed && !needsReload && !busy;
  return { data, page, setPage, query, setQuery, busy, error, message, needsReload, pending, readConfirmed, canRetry, load, read, mutate,
    retry: () => canRetry && original.current ? mutate(original.current, true) : Promise.resolve(null),
    discard: () => { if (!working.current && readConfirmed && !needsReload) { original.current = null; setPending(null); setMessage("Unrecorded intent discarded. Your typed fields remain available."); } },
  };
}
