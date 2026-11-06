"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { SUPPORT_STATUSES, SUPPORT_TOPICS, supportStatusMutationSchema, type SupportStatusMutation } from "@/lib/validations/support";
import type { SupportDetail, SupportQueue } from "@/lib/support";

const style = "rounded border px-3 py-2";
type Decision = { id: string; version: number; status: string; subject: string };
function Workspace({ ownerId }: { ownerId: string }) {
  const key = `amar:support-decision:${ownerId}`;
  const [queue, setQueue] = useState<SupportQueue | null>(null), [detail, setDetail] = useState<SupportDetail | null>(null), [decision, setDecision] = useState<Decision | null>(null);
  const [status, setStatus] = useState("OPEN"), [topic, setTopic] = useState("ALL"), [nextStatus, setNextStatus] = useState("IN_PROGRESS"), [reason, setReason] = useState("");
  const [pending, setPending] = useState<SupportStatusMutation | null>(null), [fault, setFault] = useState(false), [rejected, setRejected] = useState(false), [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [confirmed, setConfirmed] = useState(false);
  const active = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>());
  const current = () => { const user = useAuthStore.getState().user; return active.current && user?.id === ownerId && user.role === "ADMIN" && user.isVerified; };
  const invalidate = () => { setLost(true); setQueue(null); setDetail(null); void useAuthStore.getState().fetchUser().catch(() => undefined); };
  useEffect(() => { active.current = true; const requests = controllers.current; return () => { active.current = false; for (const controller of requests) controller.abort(); requests.clear(); }; }, []);
  async function request(query: string, body?: SupportStatusMutation) {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/admin/support${query}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Support-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let value;
      try { value = await response.json(); } catch { if (current() && [401, 403].includes(response.status)) invalidate(); throw Error("The support response could not be read. Reload the saved state."); }
      if (!current() || controller.signal.aborted) throw Error("The active administrator changed. Reload this page.");
      if (!response.ok || value?.success !== true) {
        if ([401, 403].includes(response.status) || value?.code === "SUPPORT_OWNER_CHANGED") invalidate();
        if (body && [400, 404, 409].includes(response.status) && value?.code !== "SUPPORT_OWNER_CHANGED") setRejected(true);
        throw Error(typeof value?.message === "string" ? value.message : "The support request was not confirmed.");
      }
      if (value.ownerId !== ownerId) { invalidate(); throw Error("The support response belongs to another account."); }
      return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current || lost) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "The request was not confirmed. Retry the saved operation."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function readQueue(page = 1, appliedStatus = status, appliedTopic = topic) {
    setConfirmed(false);
    const value = await request(`?${new URLSearchParams({ status: appliedStatus, topic: appliedTopic, page: String(page) })}`);
    if (!Array.isArray(value.rows) || value.rows.length > 20 || !Number.isSafeInteger(value.total) || !value.counts) throw Error("Support queue metadata is unavailable. Reload before making a decision.");
    setQueue(value); setConfirmed(true);
  }
  async function readDetail(id: string, eventPage = 1, choose = false) {
    const value = await request(`?${new URLSearchParams({ id, eventPage: String(eventPage) })}`);
    if (value.message?.id !== id || !Number.isSafeInteger(value.message.version) || !Array.isArray(value.history?.rows) || value.history.rows.length > 20) throw Error("Support detail metadata is unavailable.");
    setDetail(value);
    if (choose) { setDecision({ id, version: value.message.version, status: value.message.status, subject: value.message.subject }); setReason(""); setNextStatus(value.message.status === "OPEN" ? "IN_PROGRESS" : "OPEN"); }
  }
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !current()) return;
      let saved: SupportStatusMutation | null = null;
      try { const raw = sessionStorage.getItem(key); if (raw) { const value = JSON.parse(raw); if (value.ownerId !== ownerId) throw Error("Wrong saved owner"); saved = supportStatusMutationSchema.parse(value.intent); setPending(saved); } }
      catch { setFault(true); setError("The saved decision cannot be read. Recover the original operation reference before another status change."); return; }
      void run(async () => { await readQueue(1, "OPEN", "ALL"); if (saved) await readDetail(saved.id); });
    });
    return () => { cancelled = true; };
    // This workspace is keyed to the verified owner. Reloads preserve the captured decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function clearIntent() {
    sessionStorage.removeItem(key); if (sessionStorage.getItem(key) !== null) throw Error("The local decision could not be cleared. Retry its original reference before another operation.");
    setPending(null); setRejected(false);
  }
  async function save() {
    await run(async () => {
      setRejected(false);
      const input = pending ?? supportStatusMutationSchema.parse({ requestId: crypto.randomUUID(), id: decision?.id, version: decision?.version, status: nextStatus, reason });
      if (!pending) {
        const serialized = JSON.stringify({ ownerId, intent: input });
        try { sessionStorage.setItem(key, serialized); if (sessionStorage.getItem(key) !== serialized) throw Error("Storage mismatch"); }
        catch { throw Error("The original decision could not be preserved. No new operation was sent."); }
        setPending(input);
      }
      const value = await request("", input);
      if (value.result?.id !== input.id || value.result.status !== input.status || value.result.version !== input.version + 1) throw Error("The receipt does not match this status decision. Retry the original operation.");
      clearIntent(); setDecision(null); setMessage("The status decision is saved. This records internal handling; no email reply was sent by this action.");
      await readDetail(input.id); await readQueue(1, status, topic);
    });
  }
  if (lost) return <p role="alert">Administrator access changed. Private support data has been removed. Reload after signing in.</p>;
  const locked = busy || !confirmed || !!pending || fault;
  return <div className="space-y-5">
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <p>Review stored inquiries and record internal handling. Contact customers through your approved external support channel; these status actions do not send email.</p>
    {queue && <p>Open: {queue.counts.OPEN}; in progress: {queue.counts.IN_PROGRESS}; resolved: {queue.counts.RESOLVED}. {confirmed ? "Queue confirmed at last load." : "Previous queue is unconfirmed; reload before changing status."}</p>}
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void run(() => readQueue()); }}>
      <label>Status<select aria-label="Support status filter" value={status} onChange={(event) => setStatus(event.target.value)} className={style}><option value="ALL">All</option>{SUPPORT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Topic<select aria-label="Support topic filter" value={topic} onChange={(event) => setTopic(event.target.value)} className={style}><option value="ALL">All</option>{SUPPORT_TOPICS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button disabled={busy} className={style}>Load support messages</button>
    </form>
    {queue && <section aria-label="Saved support queue" className="space-y-3"><p>Applied: {queue.status} / {queue.topic}. {queue.total} matching messages; page {queue.page} of {queue.totalPages}.</p>
      {queue.rows.length === 0 && <p>No saved messages match these filters.</p>}
      {queue.rows.map((row) => <article key={row.id} className="rounded border p-3"><h2 className="font-semibold">{row.subject}</h2><p>{row.topic} / {row.status} / revision {row.version}</p><p>Received {row.createdAt}</p><code>{row.id}</code><div><button disabled={busy} onClick={() => void run(() => readDetail(row.id, 1, !pending))} className={style}>Open inquiry: {row.subject}</button></div></article>)}
      <button disabled={busy || queue.page <= 1} onClick={() => void run(() => readQueue(queue.page - 1, queue.status, queue.topic))} className={style}>Previous messages</button><button disabled={busy || queue.page >= queue.totalPages} onClick={() => void run(() => readQueue(queue.page + 1, queue.status, queue.topic))} className={style}>Next messages</button>
    </section>}
    {detail && <section aria-label="Private inquiry details" className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">{detail.message.subject}</h2><p>{detail.message.name} / {detail.message.email}</p><p>Topic: {detail.message.topic}; saved state: {detail.message.status}, revision {detail.message.version}.</p><p>Optional sender-provided reference: {detail.message.orderReference ?? "None"}. This has not verified order ownership.</p><p className="whitespace-pre-wrap break-words">{detail.message.message}</p><p>Consent recorded: {detail.message.consentAt}</p>
      <button disabled={busy} onClick={() => void run(() => readDetail(detail.message.id, detail.history.page))} className={style}>Refresh this inquiry</button>
      <h3 className="font-semibold">Status history</h3><p>{detail.history.total} changes; page {detail.history.page} of {detail.history.totalPages}.</p>
      {detail.history.rows.map((entry) => <article key={entry.id}><p>{entry.beforeStatus} → {entry.afterStatus}; revision {entry.version}; {entry.createdAt}</p><p>Administrator: {entry.actorId}</p><p>{entry.reason}</p></article>)}
      <button disabled={busy || detail.history.page <= 1} onClick={() => void run(() => readDetail(detail.message.id, detail.history.page - 1))} className={style}>Previous history</button><button disabled={busy || detail.history.page >= detail.history.totalPages} onClick={() => void run(() => readDetail(detail.message.id, detail.history.page + 1))} className={style}>Next history</button>
    </section>}
    {decision && <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3 rounded border p-4"><p>Reviewed decision: {decision.subject}; {decision.status}, revision {decision.version}. Reloading the inquiry does not replace this reviewed revision.</p><fieldset disabled={locked} className="space-y-3"><legend>Record internal handling</legend><label>New status<select aria-label="New support status" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={style}>{SUPPORT_STATUSES.filter((item) => item !== decision.status).map((item) => <option key={item}>{item}</option>)}</select></label><label className="block">Reason<input aria-label="Status reason" minLength={5} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} className={style} /></label></fieldset><button disabled={locked} className={style}>Save status decision</button></form>}
    {pending && <section className="space-y-2 rounded border p-4"><p>Unconfirmed operation: <code>{pending.requestId}</code>. Inquiry: {pending.id}, revision {pending.version}, requested status {pending.status}. Original reason: {pending.reason}</p><button disabled={busy || fault} onClick={() => void save()} className={style}>Retry original status decision</button>{rejected && <button disabled={busy || fault} onClick={() => { try { clearIntent(); setDecision(null); setError(""); } catch { setFault(true); setError("The rejected operation could not be cleared. Reload and recover its reference."); } }} className={style}>Clear rejected decision and review again</button>}</section>}
  </div>;
}

export function SupportConsole({ ownerId }: { ownerId: string }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking administrator access…</p>;
  if (!user || user.id !== ownerId || user.role !== "ADMIN" || !user.isVerified) return <p role="alert">Current administrator access is required. Reload after signing in.</p>;
  return <Workspace key={ownerId} ownerId={ownerId} />;
}
