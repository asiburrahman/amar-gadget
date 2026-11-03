"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FormInput } from "@/components/shared/form-input";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { supportContactMutationSchema, type SupportContactMutation, type SupportContactFields } from "@/lib/validations/support";
import type { SupportContactView } from "@/lib/support-contact";

type Editor = { version: number; email: string; phone: string; address: string; hours: string; published: boolean };
const empty: Editor = { version: 0, email: "", phone: "", address: "", hours: "", published: false }, style = "rounded border px-3 py-2";
function editorFor(value: (SupportContactFields & { version: number }) | null): Editor {
  return value ? { version: value.version, email: value.email ?? "", phone: value.phone ?? "", address: value.address ?? "", hours: value.hours ?? "", published: value.published } : { ...empty };
}
function Workspace({ ownerId }: { ownerId: string }) {
  const key = `amar:support-contact:${ownerId}`;
  const [data, setData] = useState<SupportContactView | null>(null), [editor, setEditor] = useState<Editor>(empty), [verified, setVerified] = useState(false), [reason, setReason] = useState("");
  const [pending, setPending] = useState<SupportContactMutation | null>(null), [fault, setFault] = useState(false), [rejected, setRejected] = useState(false), [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const active = useRef(false), working = useRef(false), controllers = useRef(new Set<AbortController>());
  const current = () => { const user = useAuthStore.getState().user; return active.current && user?.id === ownerId && user.role === "ADMIN" && user.isVerified; };
  function invalidate() { setLost(true); setData(null); void useAuthStore.getState().fetchUser().catch(() => undefined); }
  useEffect(() => { active.current = true; const requests = controllers.current; return () => { active.current = false; for (const controller of requests) controller.abort(); requests.clear(); }; }, []);
  async function request(page = 1, body?: SupportContactMutation) {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/admin/support/contact-settings${body ? "" : `?page=${page}`}`, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Support-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let value;
      try { value = await response.json(); } catch { if (current() && [401, 403].includes(response.status)) invalidate(); throw Error("The settings response could not be read. Reload the saved state."); }
      if (!current() || controller.signal.aborted) throw Error("The active administrator changed. Reload this page.");
      if (!response.ok || value?.success !== true) {
        if ([401, 403].includes(response.status) || value?.code === "SUPPORT_OWNER_CHANGED") invalidate();
        if (body && [400, 404, 409].includes(response.status) && value?.code !== "SUPPORT_OWNER_CHANGED") setRejected(true);
        throw Error(typeof value?.message === "string" ? value.message : "The settings operation was not confirmed.");
      }
      if (value.ownerId !== ownerId) { invalidate(); throw Error("The settings response belongs to another account."); }
      return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  async function run(work: () => Promise<void>) {
    if (!current() || working.current || lost) return; working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { if (current()) setError(cause instanceof Error && cause.name !== "AbortError" ? (cause.name === "ZodError" ? "Check field lengths, email/phone format, publication verification and the save reason." : cause.message) : "The operation was not confirmed. Retry the original saved decision."); }
    finally { working.current = false; if (current()) setBusy(false); }
  }
  async function read(page = 1, initialize = false) {
    setConfirmed(false); const value = await request(page);
    if (!value.history || !Array.isArray(value.history.rows) || value.history.rows.length > 20 || (value.settings && !Number.isSafeInteger(value.settings.version))) throw Error("Saved settings metadata is unavailable.");
    setData(value); setConfirmed(true); if (initialize) setEditor(editorFor(value.settings));
  }
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !current()) return;
      let saved: SupportContactMutation | null = null;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) { const value = JSON.parse(raw); if (value.ownerId !== ownerId) throw Error("Wrong saved owner"); saved = supportContactMutationSchema.parse(value.intent); setPending(saved); setEditor(editorFor({ ...saved.fields, version: saved.version })); setVerified(saved.verified); setReason(saved.reason); }
      } catch { setFault(true); setError("The saved contact-settings decision cannot be recovered. Preserve its original reference before starting another change."); return; }
      void run(() => read(1, !saved));
    });
    return () => { cancelled = true; };
    // Owner-keyed workspace: a reload preserves the editor's reviewed revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function clearIntent() {
    sessionStorage.removeItem(key); if (sessionStorage.getItem(key) !== null) throw Error("The original local decision could not be cleared. Retry its saved reference before another change.");
    setPending(null); setRejected(false);
  }
  async function save() {
    await run(async () => {
      setRejected(false);
      const fields = { email: editor.email.trim() || null, phone: editor.phone.trim() || null, address: editor.address.trim() || null, hours: editor.hours.trim() || null, published: editor.published };
      const input = pending ?? supportContactMutationSchema.parse({ requestId: crypto.randomUUID(), version: editor.version, fields, verified, reason });
      if (!pending) {
        const value = JSON.stringify({ ownerId, intent: input });
        try { sessionStorage.setItem(key, value); if (sessionStorage.getItem(key) !== value) throw Error("Storage mismatch"); }
        catch { throw Error("The exact settings decision could not be saved in this tab. No new operation was sent."); }
        setPending(input);
      }
      const value = await request(1, input), result = value.result;
      if (result?.id !== "PUBLIC" || result.version !== input.version + 1 || ["email", "phone", "address", "hours", "published"].some((field) => result[field] !== input.fields[field as keyof SupportContactFields])) throw Error("The saved receipt does not match the original settings decision. Retry it unchanged.");
      clearIntent(); setEditor(editorFor(result)); setVerified(false); setReason("");
      setMessage(result.published ? `The original decision was saved and published at version ${result.version}. Check the current saved state for any later administrator changes.` : `The original decision was saved as unpublished at version ${result.version}. Check the current saved state for any later administrator changes.`);
      await read();
    });
  }
  if (lost) return <p role="alert">Administrator access changed. Contact drafts have been removed from this view. Reload after signing in.</p>;
  const locked = busy || !confirmed || !!pending || fault;
  return <div className="space-y-5">
    <p>Manage the support details published on Contact and the homepage footer. Blank fields are omitted. Drafts remain private until you publish them. These fields do not configure SMTP or change credentials.</p>
    <Link href="/contact" className="underline">View Contact page</Link>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && <p>Saved version: {data.settings?.version ?? 0}; {data.settings?.published ? "published" : "unpublished"}. {confirmed ? "Saved state confirmed." : "Previous saved state is unconfirmed; reload before editing."}</p>}
    <div className="flex gap-3"><button disabled={busy} onClick={() => void run(() => read())} className={style}>Refresh saved settings</button><button disabled={locked || !data} onClick={() => { setEditor(editorFor(data!.settings)); setVerified(false); setReason(""); }} className={style}>Load latest into editor</button></div>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4 rounded border p-4">
      <p>Editing reviewed version {editor.version}. Refreshing saved state preserves your typed fields and this version.</p>
      <fieldset disabled={locked} className="space-y-4"><legend>Public support information</legend>
        <FormInput name="supportEmail" label="Support email" type="email" maxLength={254} value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} />
        <FormInput name="supportPhone" label="Support phone" type="tel" maxLength={32} value={editor.phone} onChange={(event) => setEditor({ ...editor, phone: event.target.value })} helperText="Include the country code. Use digits, spaces, parentheses and hyphens." />
        <FormInput name="supportAddress" label="Business address" maxLength={500} value={editor.address} onChange={(event) => setEditor({ ...editor, address: event.target.value })} />
        <FormInput name="supportHours" label="Support hours" maxLength={300} value={editor.hours} onChange={(event) => setEditor({ ...editor, hours: event.target.value })} helperText="Include the days and timezone relevant to customers." />
        <label className="flex gap-2"><input type="checkbox" checked={editor.published} onChange={(event) => setEditor({ ...editor, published: event.target.checked })} />Publish these contact details</label>
        <label className="flex gap-2"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />I verified that these details are accurate and approved for public display.</label>
        <FormInput name="contactSettingsReason" label="Reason for this change" minLength={5} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} />
      </fieldset><button disabled={locked} className={style}>Save contact settings</button>
    </form>
    {pending && <section className="space-y-2 rounded border p-4"><p>Unconfirmed settings operation: <code>{pending.requestId}</code>; reviewed version {pending.version}. Retry this exact decision to recover its original receipt.</p><button disabled={busy || fault} onClick={() => void save()} className={style}>Retry original settings decision</button>{rejected && <button disabled={busy || fault} onClick={() => { try { clearIntent(); setError(""); } catch { setFault(true); setError("The rejected decision could not be cleared. Preserve its reference and reload."); } }} className={style}>Clear rejected settings decision</button>}</section>}
    {data && <section aria-label="Contact settings history" className="space-y-3"><h2 className="text-xl font-semibold">Publication history</h2><p>{data.history.total} saved changes; page {data.history.page} of {data.history.totalPages}.</p>{data.history.rows.map((entry) => <article key={entry.id} className="rounded border p-3"><p>Version {entry.version}; administrator {entry.actorId}; {entry.createdAt}</p><p>{entry.reason}</p><p>{entry.verified ? "Public accuracy confirmed for this decision." : "Saved without public verification."}</p></article>)}<button disabled={busy || data.history.page <= 1} onClick={() => void run(() => read(data.history.page - 1))} className={style}>Previous settings history</button><button disabled={busy || data.history.page >= data.history.totalPages} onClick={() => void run(() => read(data.history.page + 1))} className={style}>Next settings history</button></section>}
  </div>;
}
export function SupportContactSettingsConsole({ ownerId }: { ownerId: string }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking administrator access…</p>;
  if (!user || user.id !== ownerId || user.role !== "ADMIN" || !user.isVerified) return <p role="alert">Current administrator access is required. Reload after signing in.</p>;
  return <Workspace key={ownerId} ownerId={ownerId} />;
}
