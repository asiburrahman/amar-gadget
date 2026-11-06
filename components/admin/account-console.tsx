"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { accountAdminMutationSchema, type AccountAdminMutation } from "@/lib/validations/admin-accounts";
import type { AccountAdminRow, AccountAdminView } from "@/lib/account-administration";
type Reply = AccountAdminView & { result: { id: string; version: number; sessionChanged: boolean }; row: AccountAdminRow | null };
const style = "rounded border p-2";
function AccountWorkspace({ ownerId, scope }: { ownerId: string; scope: "accounts" | "members" }) {
  const router = useRouter(), [data, setData] = useState<AccountAdminView | null>(null), [selected, setSelected] = useState<AccountAdminRow | null>(null), [history, setHistory] = useState<AccountAdminView | null>(null);
  const [q, setQ] = useState(""), [role, setRole] = useState("ALL"), [status, setStatus] = useState("ALL"), [verified, setVerified] = useState("ALL"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [action, setAction] = useState<AccountAdminMutation["action"]>("role"), [targetRole, setTargetRole] = useState("USER"), [targetStatus, setTargetStatus] = useState("PENDING"), [reason, setReason] = useState(""), [affirmed, setAffirmed] = useState(false);
  const [pending, setPending] = useState<AccountAdminMutation | null>(null), [confirmed, setConfirmed] = useState(false);
  const live = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>()), original = useRef<AccountAdminMutation | null>(null);
  const current = () => live.current && useAuthStore.getState().user?.id === ownerId && useAuthStore.getState().user?.role === "ADMIN";
  useEffect(() => { live.current = true; const active = controllers.current; return () => { live.current = false; for (const controller of active) controller.abort(); active.clear(); }; }, []);
  async function request(query = "", body?: AccountAdminMutation): Promise<Reply> {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`/api/admin/accounts${query}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Account-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!current() || controller.signal.aborted) throw new Error("The account or request changed. Reload saved state.");
      if (!response.ok || !value.success) throw new Error(value.message || "The account operation was not confirmed.");
      if (value.ownerId !== ownerId || (!body && value.scope !== scope)) throw new Error("The administrator or directory scope changed. Reload this page."); return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  function choose(row: AccountAdminRow) { setSelected(row); setHistory(null); setReason(""); setAffirmed(false); setTargetRole(row.role); setTargetStatus(row.sellerStatus); setAction(scope === "members" && row.role === "MEMBER" ? "seller-status" : "role"); }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "The account request failed."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function load(page = 1) {
    await run(async () => {
      setConfirmed(false); const saved = await request(`?${new URLSearchParams({ scope, page: String(page), q, role: scope === "members" ? "MEMBER" : role, sellerStatus: status, verified, ...(original.current ? { requestId: original.current.requestId } : {}) })}`);
      if (!Array.isArray(saved.rows) || saved.page !== page) throw new Error("The saved directory page could not be confirmed.");
      setData(saved); setConfirmed(true);
      if (original.current && saved.attempt) { original.current = null; setPending(null); if (saved.attemptedRow) choose(saved.attemptedRow); else setSelected(null); setMessage("The original change is recorded. Current account state loaded."); }
    });
  }
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; };
    // The workspace is remounted for the authenticated owner and directory scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = busy || !!pending || !confirmed;
  async function save(retry?: AccountAdminMutation) {
    await run(async () => {
      if (!selected || (!retry && (original.current || !confirmed))) return;
      const parsed = retry ? null : accountAdminMutationSchema.safeParse({ action, id: selected.id, version: selected.administrationVersion, requestId: crypto.randomUUID(), reason, confirmed: affirmed, ...(action === "role" ? { role: targetRole } : action === "seller-status" ? { sellerStatus: targetStatus } : {}) });
      if (parsed && !parsed.success) throw new Error(parsed.error.issues[0]?.message || "Review the account action and audit reason.");
      const intent = retry ?? (parsed && parsed.success ? parsed.data : null); if (!intent) throw new Error("Review the original account intent.");
      original.current = intent; setPending(intent); setConfirmed(false);
      const saved = await request("", intent);
      if (!saved.result?.id || !Number.isInteger(saved.result.version)) throw new Error("The saved account receipt was not confirmed. Reload before retrying.");
      original.current = null; setPending(null);
      if (saved.result.sessionChanged) { useAuthStore.getState().setUser(null); router.replace("/login"); router.refresh(); return; }
      if (saved.row) choose(saved.row); else setSelected(null); setMessage("Account change recorded. Existing sessions for that account were revoked.");
      const list = await request(`?scope=${scope}&page=1`); setData(list); setQ(""); setRole("ALL"); setStatus("ALL"); setVerified("ALL"); setConfirmed(true); router.refresh();
    });
  }
  async function showHistory(page = 1) { if (selected) await run(async () => { setHistory(await request(`?scope=${scope}&mode=history&id=${encodeURIComponent(selected.id)}&page=${page}`)); }); }
  return <section className="space-y-5"><nav className="flex flex-wrap gap-4"><Link className="underline" href="/admin/users">All accounts</Link><Link className="underline" href="/admin/members">Seller members</Link><Link className="underline" href="/admin/analytics">Analytics</Link><Link className="underline" href="/admin/reports">Order reports</Link></nav>
    <p>{scope === "members" ? "Member means a seller account. This directory includes pending, approved, blocked and rejected sellers." : "All registered accounts, separated by customer (USER), seller (MEMBER) and administrator (ADMIN) roles."} Account removal and password/verification overrides are not offered. Role changes retain purchase history; moving into MEMBER requires approval, and moving to USER hides the seller catalog belonging to that account.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="flex flex-wrap gap-3"><label>Name, email or exact account ID <input className={style} maxLength={120} value={q} disabled={busy} onChange={(event) => setQ(event.target.value)} /></label>{scope === "accounts" && <label>Role filter <select className={style} value={role} disabled={busy} onChange={(event) => setRole(event.target.value)}>{["ALL", "USER", "MEMBER", "ADMIN"].map((value) => <option key={value}>{value}</option>)}</select></label>}<label>Seller status filter <select className={style} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>{["ALL", "APPROVED", "PENDING", "BLOCKED", "REJECTED"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Email verified <select className={style} value={verified} disabled={busy} onChange={(event) => setVerified(event.target.value)}>{["ALL", "YES", "NO"].map((value) => <option key={value}>{value}</option>)}</select></label><button className={style} disabled={busy} onClick={() => void load()}>Reload saved accounts / receipt</button></div>
    {pending && <div className="rounded border p-3"><p>Unconfirmed request: {pending.requestId}. Reload its receipt before retrying the identical action.</p>{pending.id === ownerId && <p>Your own access may have changed. <Link className="underline" href="/login">Sign in again</Link> to establish the current session before further administration.</p>}<button className={style} disabled={busy || !confirmed} onClick={() => void save(original.current!)}>Retry original request</button> <button className={style} disabled={busy || !confirmed} onClick={() => { original.current = null; setPending(null); setAffirmed(false); setMessage("Unrecorded intent discarded. Review the saved revision before deciding again."); }}>Discard unrecorded intent</button></div>}
    {data && <><div className="overflow-auto"><table className="w-full text-left"><caption>{data.total} matching accounts</caption><thead><tr>{["Account", "Role", "Seller status", "Verified", "Catalog products", "Purchases", "Seller shipments", "Joined (UTC)", "Revision", "Action"].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-2"><p>{row.name || "Unnamed account"}</p><p>{row.email}</p><small>{row.id}</small></td><td>{row.role}</td><td>{row.role === "MEMBER" ? row.sellerStatus : "—"}</td><td>{row.isVerified ? "Yes" : "No"}</td><td>{row._count.products}</td><td>{row._count.orders}</td><td>{row._count.vendorFulfillments}</td><td>{row.createdAt}</td><td>{row.administrationVersion}</td><td><button className={style} disabled={locked} onClick={() => choose(row)}>Manage {row.email}</button></td></tr>)}</tbody></table></div><button className={style} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous</button> <span>Page {data.page} / {data.totalPages}</span> <button className={style} disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next</button></>}
    {selected && <form className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); if (!locked) void save(); }}><h2 className="text-xl font-semibold">Manage {selected.email} (revision {selected.administrationVersion})</h2><p>Each action revokes all current sessions for that account. Administrator promotion requires verified sign-in credentials. The last usable administrator cannot be demoted.</p>{selected.id === ownerId && <p>Changing your own role or sessions will sign you out.</p>}
      <button className={style} type="button" disabled={locked} onClick={() => void run(async () => { const saved = await request(`?scope=${scope}&mode=record&id=${encodeURIComponent(selected.id)}`); if (!saved.rows[0]) throw new Error("Account no longer exists."); choose(saved.rows[0]); })}>Load current revision (replace fields)</button> <button className={style} type="button" disabled={busy} onClick={() => void showHistory()}>View account history</button>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy || !!pending}><label>Account action <select className={`${style} w-full`} value={action} onChange={(event) => { setAction(event.target.value as AccountAdminMutation["action"]); setAffirmed(false); }}><option value="role">Change role</option>{selected.role === "MEMBER" && <option value="seller-status">Moderate seller</option>}<option value="revoke-sessions">Revoke all sessions</option></select></label>{action === "role" && <label>New role <select className={`${style} w-full`} value={targetRole} onChange={(event) => { setTargetRole(event.target.value); setAffirmed(false); }}>{["USER", "MEMBER", "ADMIN"].map((value) => <option key={value}>{value}</option>)}</select></label>}{action === "seller-status" && <label>New seller status <select className={`${style} w-full`} value={targetStatus} onChange={(event) => { setTargetStatus(event.target.value); setAffirmed(false); }}>{["APPROVED", "PENDING", "BLOCKED", "REJECTED"].map((value) => <option key={value}>{value}</option>)}</select></label>}<label>Reason <textarea className={`${style} w-full`} required minLength={5} maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value); setAffirmed(false); }} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={affirmed} onChange={(event) => setAffirmed(event.target.checked)} />I confirm this action for the displayed account and revision.</label></fieldset><button className={style} disabled={locked || !affirmed || reason.trim().length < 5 || (action === "role" && targetRole === selected.role) || (action === "seller-status" && targetStatus === selected.sellerStatus)} type="submit">Confirm account action</button>
    </form>}
    {history && <section className="space-y-2"><h2 className="text-xl font-semibold">Account security history</h2>{history.events.map((event) => <details className="rounded border p-2" key={event.id}><summary>{event.createdAt} · {event.reason ?? "Account security change"} · actor {event.actorId ?? "account workflow/operator"}</summary><pre className="overflow-auto text-xs">{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre></details>)}<button className={style} disabled={busy || history.page <= 1} onClick={() => void showHistory(history.page - 1)}>Previous history</button> <span>{history.page} / {history.totalPages}</span> <button className={style} disabled={busy || history.page >= history.totalPages} onClick={() => void showHistory(history.page + 1)}>Next history</button></section>}
  </section>;
}
export function AccountConsole({ ownerId, scope }: { ownerId: string; scope: "accounts" | "members" }) {
  const user = useAuthStore((state) => state.user); if (user?.id !== ownerId || user.role !== "ADMIN") return <p role="status">Confirm your administrator session to load accounts.</p>;
  return <AccountWorkspace key={`${ownerId}:${scope}`} ownerId={ownerId} scope={scope} />;
}
