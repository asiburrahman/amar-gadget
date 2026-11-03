"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { NEWSLETTER_STATES, NEWSLETTER_DELIVERY_STATES } from "@/lib/validations/newsletter";
import type { NewsletterAdministration } from "@/lib/newsletter-administration";
const style = "rounded border px-3 py-2";
const errors: Record<string, string> = { CONFIGURATION: "Mail configuration unavailable", TRANSPORT: "SMTP attempt not confirmed", REJECTED: "Recipient rejected by provider", REPLACED: "Preference withdrawn or replaced", ALREADY_ACTIVE: "Existing preference did not need this message", EXPIRED: "Confirmation expired", ATTEMPTS_EXHAUSTED: "Delivery attempts exhausted" };
function Workspace({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<NewsletterAdministration | null>(null), [mode, setMode] = useState<"SUBSCRIBERS" | "DELIVERIES">("SUBSCRIBERS"), [status, setStatus] = useState("ALL"), [state, setState] = useState("ALL");
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [lost, setLost] = useState(false), [error, setError] = useState(""), [loadedAt, setLoadedAt] = useState("");
  const active = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>());
  const current = () => { const user = useAuthStore.getState().user; return active.current && user?.id === ownerId && user.role === "ADMIN" && user.isVerified; };
  useEffect(() => { active.current = true; const requests = controllers.current; return () => { active.current = false; for (const controller of requests) controller.abort(); requests.clear(); }; }, []);
  function invalidate() { setLost(true); setData(null); void useAuthStore.getState().fetchUser().catch(() => undefined); }
  async function load(page = 1, requestedMode = mode, filter = requestedMode === "SUBSCRIBERS" ? status : state) {
    if (!current() || working.current || lost) return; working.current = true; setBusy(true); setError(""); setConfirmed(false);
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const query = new URLSearchParams({ mode: requestedMode, page: String(page), [requestedMode === "SUBSCRIBERS" ? "status" : "state"]: filter });
      const response = await fetch(`/api/admin/newsletter?${query}`, { method: "GET", cache: "no-store", signal: controller.signal, headers: { "X-Newsletter-Owner": ownerId } });
      let value;
      try { value = await response.json(); } catch { if (current() && [401, 403].includes(response.status)) invalidate(); throw Error("The newsletter administration response could not be read. Reload the saved view."); }
      if (!current() || controller.signal.aborted) return;
      if (!response.ok || value?.success !== true) { if ([401, 403].includes(response.status) || value?.code === "NEWSLETTER_OWNER_CHANGED") invalidate(); throw Error(typeof value?.message === "string" ? value.message : "Newsletter administration is unavailable."); }
      if (value.ownerId !== ownerId) { invalidate(); throw Error("This newsletter response belongs to another account."); }
      const expectedStates = requestedMode === "SUBSCRIBERS" ? NEWSLETTER_STATES : NEWSLETTER_DELIVERY_STATES;
      if (value.mode !== requestedMode || !Array.isArray(value.rows) || value.rows.length > 20 || !value.counts || !expectedStates.every((state) => Number.isSafeInteger(value.counts[state]) && value.counts[state] >= 0) || !Number.isSafeInteger(value.total) || value.total < 0 || value.totalPages !== Math.max(1, Math.ceil(value.total / 20)) || value.page !== page || page > value.totalPages) throw Error("Newsletter page metadata could not be confirmed.");
      setData(value); setConfirmed(true); setLoadedAt(new Date().toISOString());
    } catch (cause) { if (current()) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "The saved newsletter view was not confirmed. Reload to try again."); }
    finally { clearTimeout(timeout); controllers.current.delete(controller); working.current = false; if (current()) setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(1, "SUBSCRIBERS", "ALL"); }); return () => { cancelled = true; };
    // Each workspace belongs to one verified owner. Applying filters is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (lost) return <p role="alert">Administrator access changed. Private newsletter data has been removed. Reload after signing in.</p>;
  return <div className="space-y-5">
    <p>Only ACTIVE recipients have confirmed newsletter consent. SENT records SMTP acceptance for an instruction message; it does not confirm inbox delivery or a marketing campaign. Pending and withdrawn preferences must not receive marketing.</p>
    <p>Delivery retries run through the supervised newsletter worker. Correct mail configuration/provider issues before retrying. DEAD or expired requests require the recipient to request fresh instructions; this screen does not manufacture consent or send a campaign.</p>
    {error && <p role="alert">{error}</p>}
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label>View<select aria-label="Newsletter view" className={style} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="SUBSCRIBERS">Subscriber consent</option><option value="DELIVERIES">Instruction delivery</option></select></label>
      {mode === "SUBSCRIBERS" ? <label>Status<select aria-label="Newsletter consent filter" className={style} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">ALL</option>{NEWSLETTER_STATES.map((item) => <option key={item}>{item}</option>)}</select></label> : <label>Delivery state<select aria-label="Newsletter delivery filter" className={style} value={state} onChange={(event) => setState(event.target.value)}><option value="ALL">ALL</option>{NEWSLETTER_DELIVERY_STATES.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <button disabled={busy} className={style}>{busy ? "Loading saved data…" : "Load newsletter records"}</button>
    </form>
    {data && <section className="space-y-3" aria-label="Saved newsletter records"><p>{confirmed ? `Saved view loaded ${loadedAt}.` : "Previous view is unconfirmed. Reload the saved state."}</p><p>Applied: {data.mode} / {data.mode === "SUBSCRIBERS" ? data.status : data.state}; {data.total} matching records, page {data.page} of {data.totalPages}.</p><p>Whole-view counts: {Object.entries(data.counts).map(([key, value]) => `${key}: ${value}`).join("; ")}</p>
      {data.rows.length === 0 && <p>No saved records match these filters.</p>}
      {data.mode === "SUBSCRIBERS" ? data.rows.map((row) => <article key={row.id} className="space-y-1 rounded border p-3"><h2 className="font-semibold break-words">{row.email}</h2><p>Consent: {row.status}; policy {row.consentVersion}.</p><p>Requested: {row.consentedAt}; confirmed: {row.confirmedAt ?? "Not confirmed"}; withdrawn: {row.unsubscribedAt ?? "Not withdrawn"}.</p><p>Last instructions requested: {row.lastRequestedAt}.</p></article>) : data.rows.map((row) => <article key={row.id} className="space-y-1 rounded border p-3"><h2 className="font-semibold break-words">{row.email}</h2><p>Request: <code>{row.id}</code></p><p>{row.state}; {row.attempts} attempts; confirmation generation {row.generation}.</p><p>Next attempt: {row.nextAttemptAt}; lease until: {row.leaseUntil ?? "No active lease"}; SMTP accepted: {row.sentAt ?? "Not confirmed"}.</p><p>Delivery note: {row.lastErrorCode ? errors[row.lastErrorCode] ?? "Operator review required" : "No recorded error"}.</p></article>)}
      <button disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1, data.mode, data.mode === "SUBSCRIBERS" ? data.status : data.state)} className={style}>Previous newsletter records</button><button disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1, data.mode, data.mode === "SUBSCRIBERS" ? data.status : data.state)} className={style}>Next newsletter records</button>
    </section>}
  </div>;
}
export function NewsletterAdministrationConsole({ ownerId }: { ownerId: string }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking administrator access…</p>;
  if (!user || user.id !== ownerId || user.role !== "ADMIN" || !user.isVerified) return <p role="alert">Current administrator access is required. Reload after signing in.</p>;
  return <Workspace key={ownerId} ownerId={ownerId} />;
}
