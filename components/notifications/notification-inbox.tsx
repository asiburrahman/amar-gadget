"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import type { NotificationInbox } from "@/lib/notifications";
import { NOTIFICATION_KINDS } from "@/lib/notification-policy";
import { notificationMutationSchema, type NotificationMutation } from "@/lib/validations/notification";
import { useNotificationRequests } from "./use-notification-requests";
type Props = { ownerId: string; ownerRole: "USER" | "MEMBER" | "ADMIN" };
type Query = Pick<NotificationInbox, "page" | "filter" | "kind">;
const style = "rounded border px-3 py-2";
function Inbox({ ownerId, ownerRole }: Props) {
  const [data, setData] = useState<NotificationInbox | null>(null), [filter, setFilter] = useState<Query["filter"]>("ALL"), [kind, setKind] = useState<Query["kind"]>("ALL");
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [loadedAt, setLoadedAt] = useState("");
  const working = useRef(false), applied = useRef<Query>({ page: 1, filter: "ALL", kind: "ALL" });
  const accessLost = useCallback(() => { setData(null); setConfirmed(false); }, []), { current, request } = useNotificationRequests(ownerId, ownerRole, accessLost);
  async function read(query: Query) {
    const value = await request(`/api/notifications?${new URLSearchParams({ page: String(query.page), filter: query.filter, kind: query.kind })}`);
    if (value.ownerRole !== ownerRole || value.page !== query.page || value.filter !== query.filter || value.kind !== query.kind || !Array.isArray(value.rows) || !Number.isSafeInteger(value.unread) || !Number.isSafeInteger(value.totalNotifications)) throw new Error("The saved inbox page could not be confirmed.");
    applied.current = query; setData(value as unknown as NotificationInbox); setConfirmed(true); setLoadedAt(new Date().toISOString());
  }
  async function run(work: () => Promise<void>, quiet = false) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); if (!quiet) setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The inbox request failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(query = applied.current, quiet = false) { await run(async () => { setConfirmed(false); await read(query); }, quiet); }
  useEffect(() => {
    let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); });
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(applied.current, true); }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
    // The parent keys this workspace by the authenticated owner/role. Polling
    // reads applied filters from a ref rather than rebasing an unfinished filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function change(input: NotificationMutation) {
    await run(async () => {
      if (!confirmed) return; const parsed = notificationMutationSchema.safeParse(input); if (!parsed.success) throw new Error("Reload the saved notification revisions before deciding again.");
      setConfirmed(false); const result = await request("/api/notifications", parsed.data);
      if (!Number.isSafeInteger(result.changed)) throw new Error("The saved read-state result could not be confirmed. Reload your inbox.");
      await read({ ...applied.current, page: 1 }); setMessage("Saved notification read state reloaded.");
    });
  }
  const locked = busy || !confirmed, unreadRows = data?.rows.filter((row) => row.readAt === null) ?? [];
  return <section className="space-y-5"><nav className="flex flex-wrap gap-4"><Link className="underline" href={ownerRole === "ADMIN" ? "/admin" : ownerRole === "MEMBER" ? "/member/dashboard" : "/user/dashboard"}>Dashboard</Link>{ownerRole === "ADMIN" && <Link className="underline" href="/admin/notifications/delivery">Delivery queue and recovery</Link>}</nav>
    <p>Your inbox contains delivered messages for your current account and role. Status text records a past update; links open the current authorized details. This visible tab refreshes every 30 seconds.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void load({ page: 1, filter, kind }); }}><label>Read filter <select className={style} disabled={busy} value={filter} onChange={(event) => setFilter(event.target.value as Query["filter"])}>{["ALL", "UNREAD", "READ"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Notification kind <select className={style} disabled={busy} value={kind} onChange={(event) => setKind(event.target.value as Query["kind"])}>{["ALL", ...NOTIFICATION_KINDS].map((value) => <option key={value}>{value}</option>)}</select></label><button className={style} disabled={busy}>Apply inbox filters</button><button type="button" className={style} disabled={busy} onClick={() => void load()}>Refresh saved inbox</button></form>
    {data ? <><p>{data.unread} unread / {data.totalNotifications} delivered messages in your current role. Saved view loaded {loadedAt}. {!confirmed && "Reload before changing read state."}</p><p>Applied filters: {data.filter}, {data.kind}. {data.total} matching messages.</p><button className={style} disabled={locked || !unreadRows.length} onClick={() => void change({ action: "read-page", entries: unreadRows.map((row) => ({ id: row.id, version: row.readVersion })) })}>Mark visible unread messages read</button>
      <ul className="space-y-3">{data.rows.map((row) => <li key={row.id} className={`space-y-2 rounded border p-4 ${row.readAt === null ? "border-primary" : ""}`}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{row.title}</h2><span>{row.readAt === null ? "Unread" : "Read"}</span></div><p>{row.body}</p><p className="text-sm">Recorded <time dateTime={row.occurredAt}>{row.occurredAt}</time>; delivered <time dateTime={row.deliveredAt}>{row.deliveredAt}</time>. {row.readAt && <>Read at <time dateTime={row.readAt}>{row.readAt}</time>.</>}</p><div className="flex flex-wrap gap-4"><Link className="underline" href={row.href}>View current details</Link><button className={style} disabled={locked} onClick={() => void change({ action: row.readAt === null ? "read" : "unread", id: row.id, version: row.readVersion })}>{row.readAt === null ? "Mark read" : "Mark unread"}: {row.title}</button></div></li>)}</ul>
      {!data.rows.length && <p>No delivered messages match these filters. New events appear after background delivery.</p>}<div className="flex flex-wrap gap-3"><button className={style} disabled={busy || data.page <= 1} onClick={() => void load({ ...applied.current, page: data.page - 1 })}>Previous inbox page</button><span>Page {data.page} / {data.totalPages}</span><button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load({ ...applied.current, page: data.page + 1 })}>Next inbox page</button></div></> : !error && <p role="status">Loading your saved inbox...</p>}
  </section>;
}
export function NotificationInboxConsole(props: Props) {
  const { user, loading } = useAuth(); if (loading) return <p role="status">Loading inbox account...</p>;
  if (user?.id !== props.ownerId || user.role !== props.ownerRole || !user.isVerified) return <p role="status">Sign in again with the matching inbox account.</p>;
  return <Inbox key={`${props.ownerId}:${props.ownerRole}`} {...props} />;
}
