"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { siteContentAddressSchema, siteContentFieldsSchema, siteContentMutationSchema, siteContentStateSchema, type SiteContentAddress, type SiteContentFields } from "@/lib/validations/site-content";

const timestamp = z.string().datetime();
const savedSchema = siteContentStateSchema.safeExtend({ publishedAt: timestamp.nullable(), updatedAt: timestamp });
const historyRowSchema = z.object({ version: z.number().int().positive(), action: z.enum(["DRAFT", "PUBLISH", "UNPUBLISH"]), actorId: z.string(), reason: z.string(), reviewed: z.boolean(), createdAt: timestamp }).strict();
const viewSchema = z.object({ success: z.literal(true), ownerId: z.string(), address: siteContentAddressSchema,
  document: savedSchema.nullable(), publication: z.unknown(),
  history: z.object({ page: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().positive(), rows: z.array(historyRowSchema).max(20) }).strict(),
}).strict();
const decisionSchema = z.object({ ownerId: z.string(), input: siteContentMutationSchema, snapshot: siteContentFieldsSchema }).strict();
type Decision = z.infer<typeof decisionSchema>;
type View = z.infer<typeof viewSchema>;
const blank: SiteContentFields = { title: "", summary: "", byline: "", sections: [] };
const control = "rounded border px-3 py-2 disabled:opacity-50";
class ContentRequestError extends Error {}

function Workspace({ ownerId, kind, slug }: { ownerId: string } & SiteContentAddress) {
  const storageKey = `amar:site-content:${ownerId}:${kind}:${slug}`;
  const [view, setView] = useState<View | null>(null), [fields, setFields] = useState<SiteContentFields>(blank), [version, setVersion] = useState(0);
  const [reason, setReason] = useState(""), [reviewed, setReviewed] = useState(false), [pending, setPending] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [lost, setLost] = useState(false), [fault, setFault] = useState(false), [rejected, setRejected] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [snapshot, setSnapshot] = useState<string | null>(null);
  const active = useRef(false), running = useRef(false), denied = useRef(false), controllers = useRef(new Set<AbortController>());
  const current = useCallback(() => {
    const actor = useAuthStore.getState().user;
    return active.current && !denied.current && actor?.id === ownerId && actor.role === "ADMIN" && actor.isVerified;
  }, [ownerId]);
  const invalidate = useCallback(() => {
    denied.current = true; setLost(true); setView(null); setSnapshot(null);
    void useAuthStore.getState().fetchUser().catch(() => undefined);
  }, []);
  useEffect(() => {
    active.current = true;
    const requests = controllers.current;
    return () => { active.current = false; for (const controller of requests) controller.abort(); requests.clear(); };
  }, []);

  const request = useCallback(async (query: URLSearchParams, input?: Decision["input"]): Promise<unknown> => {
    if (!current()) throw new ContentRequestError("The active administrator changed. Reload after signing in.");
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/admin/site-content${input ? "" : `?${query}`}`, {
        method: input ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        headers: { "X-Site-Content-Owner": ownerId, ...(input ? { "Content-Type": "application/json" } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      if (!current() || controller.signal.aborted) throw new ContentRequestError("Administrator access changed. Reload this page.");
      if ([401, 403].includes(response.status)) { invalidate(); throw new ContentRequestError("Current administrator access is required."); }
      const raw: unknown = await response.json();
      const status = z.object({ success: z.boolean(), ownerId: z.string().optional(), message: z.string().optional(), code: z.string().optional(), reference: z.string().optional() }).passthrough().parse(raw);
      if (!current() || controller.signal.aborted) throw new ContentRequestError("Administrator access changed. Reload this page.");
      if (status.code === "SITE_CONTENT_OWNER_CHANGED" || (status.success && status.ownerId !== ownerId)) {
        invalidate(); throw new ContentRequestError("The response belongs to another administrator. Reload this page.");
      }
      if (!response.ok || !status.success) {
        if (input && [400, 404, 409, 413, 415].includes(response.status)) setRejected(true);
        throw new ContentRequestError(`${status.message ?? "The operation was not confirmed."}${status.reference ? ` Reference: ${status.reference}.` : ""}`);
      }
      return raw;
    } catch (cause) {
      if (cause instanceof ContentRequestError) throw cause;
      throw new ContentRequestError("The content response could not be confirmed. Refresh saved state or retry the original saved decision.");
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }, [current, invalidate, ownerId]);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (!current() || running.current) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); }
    catch (cause) {
      if (current()) setError(cause instanceof z.ZodError ? "The document or service response could not be validated. Check field limits and reload the saved state."
        : cause instanceof Error && cause.name !== "AbortError" ? cause.message : "The operation was not confirmed. Retry its original reference.");
    } finally { running.current = false; if (current()) setBusy(false); }
  }, [current]);

  const read = useCallback(async (page = 1, initialize = false) => {
    setConfirmed(false);
    const data = viewSchema.parse(await request(new URLSearchParams({ kind, slug, page: String(page) })));
    if (data.address.kind !== kind || data.address.slug !== slug || (data.document && (data.document.kind !== kind || data.document.slug !== slug))) throw Error("The saved document belongs to another address.");
    setView(data); setConfirmed(true);
    if (initialize) { setFields(data.document?.draft ?? blank); setVersion(data.document?.version ?? 0); setReviewed(false); setReason(""); }
  }, [kind, slug, request]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !current()) return;
      let recovered: Decision | null = null;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          recovered = decisionSchema.parse(JSON.parse(raw));
          if (recovered.ownerId !== ownerId || recovered.input.kind !== kind || recovered.input.slug !== slug) throw Error("Saved decision address mismatch");
          setPending(recovered); setFields(recovered.snapshot); setVersion(recovered.input.version); setReason(recovered.input.reason); setReviewed(recovered.input.action === "PUBLISH");
        }
      } catch {
        setFault(true); setError("The original saved decision cannot be recovered. Preserve this tab's operation reference before starting another change."); return;
      }
      void run(() => read(1, !recovered));
    });
    return () => { cancelled = true; };
  }, [current, kind, ownerId, read, run, slug, storageKey]);

  function clearDecision() {
    sessionStorage.removeItem(storageKey);
    if (sessionStorage.getItem(storageKey) !== null) throw Error("The original saved decision could not be cleared. Retry its original reference.");
    setPending(null); setRejected(false);
  }
  async function decide(action: Decision["input"]["action"]) {
    await run(async () => {
      const decision = pending ?? decisionSchema.parse({ ownerId, snapshot: fields, input: {
        kind, slug, version, requestId: crypto.randomUUID(), action, reason,
        ...(action === "DRAFT" ? { fields } : action === "PUBLISH" ? { reviewed } : {}),
      } });
      if (!pending) {
        const value = JSON.stringify(decision);
        try { sessionStorage.setItem(storageKey, value); if (sessionStorage.getItem(storageKey) !== value) throw Error("Storage mismatch"); }
        catch { throw Error("The exact decision could not be retained in this tab. No new operation was sent."); }
        setPending(decision); setRejected(false);
      }
      const response = z.object({ success: z.literal(true), ownerId: z.string(), result: savedSchema.safeExtend({ path: z.string() }) }).strict().parse(await request(new URLSearchParams(), decision.input));
      const result = response.result, expected = decision.input;
      if (result.kind !== kind || result.slug !== slug || result.version !== expected.version + 1 ||
        JSON.stringify(result.draft) !== JSON.stringify(decision.snapshot) ||
        (expected.action === "PUBLISH" && result.publishedVersion !== result.version) ||
        (expected.action === "UNPUBLISH" && result.publishedVersion !== null)) throw Error("The receipt does not match the original decision. Retry it unchanged.");
      clearDecision(); setFields(result.draft); setVersion(result.version); setReviewed(false); setReason("");
      setMessage(`Original ${expected.action.toLowerCase()} decision confirmed at revision ${result.version}. The current saved state may include later administrator changes.`);
      await read();
    });
  }

  async function inspect(revision: number) {
    await run(async () => {
      setSnapshot(null);
      const data = z.object({ success: z.literal(true), ownerId: z.string(), revision: historyRowSchema.safeExtend({
        kind: z.enum(["PAGE", "ARTICLE"]), slug: z.string(), before: siteContentStateSchema.nullable(), after: siteContentStateSchema,
      }) }).strict().parse(await request(new URLSearchParams({ kind, slug, revision: String(revision) })));
      if (data.revision.kind !== kind || data.revision.slug !== slug || data.revision.version !== revision) throw Error("The retained revision does not match this document.");
      setSnapshot(JSON.stringify(data.revision, null, 2));
    });
  }
  if (lost) return <p role="alert">Administrator access changed. The private document has been removed from this view. Reload after signing in.</p>;
  const locked = busy || !confirmed || !!pending || fault;
  const saved = !!view?.document && view.document.version === version && JSON.stringify(view.document.draft) === JSON.stringify(fields);
  const publicPath = kind === "PAGE" ? `/${slug}` : `/blog/${slug}`;
  function change(next: SiteContentFields) { setFields(next); setReviewed(false); }
  return <div className="space-y-6">
    <nav className="flex gap-4"><Link href="/admin/settings/content" className="underline">All content</Link><Link href={publicPath} className="underline">View public page</Link></nav>
    <p>Write plain text. Save the draft before reviewing it for publication. Information entered here is public only after an explicit publication. Do not include passwords or private customer data.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {view && <p>Saved revision {view.document?.version ?? 0}; {view.document?.publishedVersion ? `public revision ${view.document.publishedVersion}` : "unpublished"}. {confirmed ? "Saved state confirmed." : "Saved state is unconfirmed; refresh before editing."}</p>}
    <div className="flex flex-wrap gap-3">
      <button className={control} disabled={busy || fault} onClick={() => void run(() => read())}>Refresh saved state</button>
      <button className={control} disabled={locked || !view} onClick={() => { setFields(view!.document?.draft ?? blank); setVersion(view!.document?.version ?? 0); setReviewed(false); setReason(""); }}>Load latest into editor</button>
    </div>
    <form className="space-y-5 rounded-xl border p-5" onSubmit={(event) => { event.preventDefault(); void decide("DRAFT"); }}>
      <p>Editing revision {version}. Refresh preserves your typed fields and this reviewed version.</p>
      <fieldset disabled={locked} className="space-y-4"><legend className="font-semibold">Private draft</legend>
        <label className="grid gap-2">Title<input className={control} value={fields.title} maxLength={160} onChange={(event) => change({ ...fields, title: event.target.value })} /></label>
        <label className="grid gap-2">Summary<textarea className={control} rows={3} value={fields.summary} maxLength={500} onChange={(event) => change({ ...fields, summary: event.target.value })} /></label>
        <label className="grid gap-2">Byline (optional)<input className={control} value={fields.byline} maxLength={100} onChange={(event) => change({ ...fields, byline: event.target.value })} /></label>
        {fields.sections.map((section, index) => <fieldset key={index} className="space-y-3 rounded border p-4"><legend>Section {index + 1}</legend>
          <label className="grid gap-2">{slug === "faq" && kind === "PAGE" ? "Question" : "Heading"}<input className={control} value={section.heading} maxLength={160} onChange={(event) => change({ ...fields, sections: fields.sections.map((item, at) => at === index ? { ...item, heading: event.target.value } : item) })} /></label>
          <label className="grid gap-2">{slug === "faq" && kind === "PAGE" ? "Answer" : "Body"}<textarea className={control} rows={7} value={section.body} maxLength={8000} onChange={(event) => change({ ...fields, sections: fields.sections.map((item, at) => at === index ? { ...item, body: event.target.value } : item) })} /></label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={control} disabled={index === 0} onClick={() => { const sections = [...fields.sections]; [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]]; change({ ...fields, sections }); }}>Move section {index + 1} up</button>
            <button type="button" className={control} disabled={index === fields.sections.length - 1} onClick={() => { const sections = [...fields.sections]; [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]]; change({ ...fields, sections }); }}>Move section {index + 1} down</button>
            <button type="button" className={control} onClick={() => change({ ...fields, sections: fields.sections.filter((_, at) => at !== index) })}>Remove section {index + 1}</button>
          </div>
        </fieldset>)}
        <button type="button" className={control} disabled={fields.sections.length >= 24} onClick={() => change({ ...fields, sections: [...fields.sections, { heading: "", body: "" }] })}>Add section</button>
        <label className="grid gap-2">Reason for this decision<input className={control} value={reason} minLength={5} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={reviewed} disabled={!saved} onChange={(event) => setReviewed(event.target.checked)} />I reviewed this exact saved draft and approve it for public display.</label>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <button className={control} disabled={locked || saved}>Save private draft</button>
        <button type="button" className={control} disabled={locked || !saved || !reviewed} onClick={() => void decide("PUBLISH")}>Publish reviewed saved draft</button>
        <button type="button" className={control} disabled={locked || !saved || !view?.document?.publishedVersion} onClick={() => void decide("UNPUBLISH")}>Unpublish document</button>
      </div>
    </form>
    {pending && <section className="space-y-3 rounded border p-4" aria-label="Unconfirmed content decision">
      <p>Original {pending.input.action.toLowerCase()} reference: <code>{pending.input.requestId}</code>; reviewed revision {pending.input.version}. Retry unchanged to recover its original receipt.</p>
      <button className={control} disabled={busy || fault} onClick={() => void decide(pending.input.action)}>Retry original content decision</button>
      {rejected && <button className={control} disabled={busy || fault} onClick={() => { try { clearDecision(); setError(""); } catch { setFault(true); setError("The rejected decision could not be cleared. Preserve its reference and reload."); } }}>Clear rejected content decision</button>}
    </section>}
    {view && <section aria-label="Content publication history" className="space-y-3"><h2 className="text-xl font-semibold">Retained history</h2>
      <p>{view.history.total} decisions; page {view.history.page} of {view.history.totalPages}.</p>
      {view.history.rows.map((entry) => <article key={entry.version} className="space-y-2 rounded border p-4">
        <p>Revision {entry.version}: {entry.action}; {entry.createdAt}; administrator {entry.actorId}</p><p>{entry.reason}</p>
        <button className={control} disabled={busy} onClick={() => void inspect(entry.version)}>Inspect revision {entry.version}</button>
      </article>)}
      <div className="flex gap-3"><button className={control} disabled={busy || view.history.page <= 1} onClick={() => void run(() => read(view.history.page - 1))}>Previous history</button>
        <button className={control} disabled={busy || view.history.page >= view.history.totalPages} onClick={() => void run(() => read(view.history.page + 1))}>Next history</button></div>
    </section>}
    {snapshot && <section aria-label="Retained revision details" className="space-y-3"><h2 className="text-xl font-semibold">Retained revision snapshot</h2><button className={control} onClick={() => setSnapshot(null)}>Close snapshot</button><pre className="overflow-auto whitespace-pre-wrap wrap-break-word rounded border p-4">{snapshot}</pre></section>}
  </div>;
}

export function SiteContentEditor({ ownerId, address }: { ownerId: string; address: SiteContentAddress }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking administrator access…</p>;
  if (!user || user.id !== ownerId || user.role !== "ADMIN" || !user.isVerified) return <p role="alert">Current administrator access is required. Reload after signing in.</p>;
  return <Workspace key={`${ownerId}:${address.kind}:${address.slug}`} ownerId={ownerId} {...address} />;
}
