"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import type { NotificationQueue } from "@/lib/notifications";
import { notificationRetrySchema, NOTIFICATION_QUEUE_STATES } from "@/lib/validations/notification";
import { useNotificationRequests } from "./use-notification-requests";
const style = "rounded border px-3 py-2";
function Queue({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<NotificationQueue | null>(null), [state, setState] = useState<NotificationQueue["state"]>("PROBLEMS"), [selected, setSelected] = useState<NotificationQueue["rows"][number] | null>(null);
  const [reason, setReason] = useState(""), [affirmed, setAffirmed] = useState(false), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const working = useRef(false), applied = useRef({ state: "PROBLEMS" as NotificationQueue["state"], page: 1 });
  const accessLost = useCallback(() => { setData(null); setSelected(null); setConfirmed(false); }, []), { current, request } = useNotificationRequests(ownerId, "ADMIN", accessLost);
  async function read(page = applied.current.page, nextState = applied.current.state) {
    const value = await request(`/api/admin/notifications/queue?${new URLSearchParams({ page: String(page), state: nextState })}`);
    if (value.page !== page || value.state !== nextState || !Array.isArray(value.rows) || !value.counts) throw new Error("The saved delivery queue could not be confirmed.");
    applied.current = { page, state: nextState }; setData(value as unknown as NotificationQueue); setConfirmed(true);
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The delivery queue request failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(page = applied.current.page, nextState = applied.current.state) { await run(async () => { setConfirmed(false); await read(page, nextState); }); }
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; };
    // The parent keys this workspace by the current administrator; a reload
    // deliberately preserves a selected retry's observed revision and reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = busy || !confirmed;
  async function retry() {
    await run(async () => {
      if (!selected || !confirmed || !affirmed) return; const parsed = notificationRetrySchema.safeParse({ id: selected.id, version: selected.version, reason });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Review the saved event revision and retry reason.");
      setConfirmed(false); const result = await request("/api/admin/notifications/queue", parsed.data);
      if (typeof result.requeued !== "boolean") throw new Error("The retry was not confirmed. Reload the saved event before deciding again.");
      setSelected(null); setReason(""); setAffirmed(false); await read(1); setMessage(result.requeued ? "Delivery event requeued from its saved checkpoint. This does not claim a message was delivered." : "The original event is already queued. No additional retry instruction was recorded.");
    });
  }
  return <section className="space-y-5"><Link className="underline" href="/admin/notifications">My administrator inbox</Link><p>This queue covers in-app delivery. RETRY uses automatic backoff; DEAD requires operator review. SKIPPED is not delivery. Retry preserves the last completed recipient checkpoint and never resends already stored messages. Active claims and removed sources cannot be force-retried here.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void load(1, state); }}><label>Delivery state <select className={style} disabled={busy} value={state} onChange={(event) => setState(event.target.value as NotificationQueue["state"])}>{["PROBLEMS", "ALL", ...NOTIFICATION_QUEUE_STATES].map((value) => <option key={value}>{value}</option>)}</select></label><button className={style} disabled={busy}>Apply delivery filter</button><button type="button" className={style} disabled={busy} onClick={() => void load()}>Reload saved delivery queue</button></form>
    {data && <><dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(data.counts).map(([key, value]) => <div className="rounded border p-3" key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p>Applied state: {data.state}; {data.total} matching events. Stored inbox row counts may decrease when the owning account is removed.</p><div className="overflow-auto"><table className="w-full text-left"><caption>Durable in-app delivery events</caption><thead><tr>{["Event / source", "Audience / recipients", "State / revision", "Attempts / total claims", "Checkpoint / stored messages", "Next attempt / lease (UTC)", "Failure code", "Action"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-2">{row.kind}<small className="block">{row.id}</small><small>{row.subjectType}: {row.subjectId}</small></td><td>{row.audience} / {row.recipientGroup}<small className="block">{row.recipientId}</small></td><td>{row.state} / {row.version}</td><td>{row.attempts} / {row.claimCount}</td><td>{row.cursorId ?? "No completed page"}<p>{row.deliveredRecipients} stored messages</p></td><td>{row.nextAttemptAt}<p>{row.leaseUntil}</p></td><td>{row.lastErrorCode ?? "None recorded"}</td><td>{(row.state === "RETRY" || row.state === "DEAD" || (row.state === "SKIPPED" && row.lastErrorCode === "NO_RECIPIENTS")) && <button className={style} disabled={locked} onClick={() => { setSelected(row); setReason(""); setAffirmed(false); }}>Review retry {row.id}</button>}</td></tr>)}</tbody></table></div>{!data.rows.length && <p>No delivery events match this filter.</p>}<div className="flex flex-wrap gap-3"><button className={style} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous delivery page</button><span>Page {data.page} / {data.totalPages}</span><button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next delivery page</button></div></>}
    {selected && <form aria-label="Retry notification delivery" className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); if (!locked) void retry(); }}><h2 className="text-lg font-semibold">Review delivery event {selected.id}</h2><p>Observed {selected.state}, revision {selected.version}, code {selected.lastErrorCode}. Reloading the queue does not replace this reviewed revision.</p><label className="block">Retry reason <input className={`${style} w-full`} disabled={busy} minLength={5} maxLength={500} required value={reason} onChange={(event) => { setReason(event.target.value); setAffirmed(false); }} /></label><label className="block"><input type="checkbox" disabled={busy} checked={affirmed} onChange={(event) => setAffirmed(event.target.checked)} /> I reviewed the cause and confirm retrying this saved event from its checkpoint.</label><button className={style} disabled={locked || !affirmed || reason.trim().length < 5}>Confirm delivery requeue</button></form>}
  </section>;
}
export function NotificationQueueConsole({ ownerId }: { ownerId: string }) {
  const { user, loading } = useAuth(); if (loading) return <p role="status">Loading delivery administrator...</p>;
  if (user?.id !== ownerId || user.role !== "ADMIN" || !user.isVerified) return <p role="status">Current matching administrator access is required.</p>;
  return <Queue key={ownerId} ownerId={ownerId} />;
}
