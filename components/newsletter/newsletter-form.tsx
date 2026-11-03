"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { newsletterSubscribeSchema, type NewsletterSubscribe } from "@/lib/validations/newsletter";
const key = "amar:newsletter-request:v1";
type Receipt = { requestId: string; recordedAt: string };
function receiptValue(value: unknown): Receipt {
  if (!value || typeof value !== "object" || !("requestId" in value) || !("recordedAt" in value) || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId) || typeof value.recordedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt))) throw Error("The original request receipt could not be confirmed. Retry it unchanged.");
  return { requestId: value.requestId, recordedAt: value.recordedAt };
}
export function NewsletterForm() {
  const [email, setEmail] = useState(""), [consent, setConsent] = useState(false), [pending, setPending] = useState<NewsletterSubscribe | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [fault, setFault] = useState(false), [error, setError] = useState(""), [editable, setEditable] = useState(false);
  const active = useRef(false), working = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true; let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) { const saved = JSON.parse(raw); if (saved.receipt) setReceipt(receiptValue(saved.receipt)); else { const intent = newsletterSubscribeSchema.parse(saved.intent); setPending(intent); setEmail(intent.email); setConsent(true); } }
      } catch { setFault(true); setError("The saved newsletter request cannot be recovered safely. Preserve its original reference before starting another request."); }
      setReady(true);
    });
    return () => { cancelled = true; active.current = false; controller.current?.abort(); };
  }, []);
  function store(value: unknown) { const raw = JSON.stringify(value); sessionStorage.setItem(key, raw); if (sessionStorage.getItem(key) !== raw) throw Error("This tab could not preserve the original newsletter request."); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!ready || working.current || fault || receipt) return;
    working.current = true; setBusy(true); setError(""); setEditable(false); let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = pending ?? newsletterSubscribeSchema.parse({ requestId: crypto.randomUUID(), email, consent });
      if (!pending) { try { store({ intent: input }); } catch { throw Error("Enable session storage so this tab can preserve an exact retry. No new request was sent."); } setPending(input); }
      const request = new AbortController(); controller.current = request; timeout = setTimeout(() => request.abort(), 45_000);
      const response = await fetch("/api/newsletter", { method: "POST", cache: "no-store", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      let value;
      try { value = await response.json(); } catch { throw Error("Delivery was not confirmed. The original request is retained for retry."); }
      if (!active.current || request.signal.aborted) return;
      if (!response.ok || value?.success !== true) { setEditable([400, 413, 415].includes(response.status) || value?.code === "NEWSLETTER_RETRY_EXHAUSTED"); throw Error(typeof value?.message === "string" ? value.message : "The newsletter request was not confirmed. Retry the original request later."); }
      const saved = receiptValue(value.receipt); if (saved.requestId !== input.requestId) throw Error("The receipt does not match this request. Retry the original request unchanged.");
      try { store({ receipt: saved }); } catch { setFault(true); setError("The request is recorded, but this tab could not replace its retry record. Keep the reference and reload before another request."); }
      setReceipt(saved); setPending(null); setEmail(""); setConsent(false);
    } catch (cause) { if (active.current) setError(cause instanceof Error && cause.name !== "AbortError" ? (cause.name === "ZodError" ? "Enter a valid email and agree to receiving preference instructions." : cause.message) : "The request was not confirmed. Retry the same saved request."); }
    finally { if (timeout) clearTimeout(timeout); working.current = false; controller.current = null; if (active.current) setBusy(false); }
  }
  function clear() {
    try { sessionStorage.removeItem(key); if (sessionStorage.getItem(key) !== null) throw Error("Saved metadata remains"); setReceipt(null); setPending(null); setEditable(false); setError(""); }
    catch { setFault(true); setError("This tab could not clear its saved request. Keep its original reference and reload before another request."); }
  }
  return <div className="w-full max-w-lg space-y-3">
    {!ready && <p role="status">Checking for an unfinished newsletter request…</p>}{error && <p role="alert">{error}</p>}
    {receipt ? <div role="status" className="space-y-2"><p className="font-semibold">Newsletter request recorded</p><p>Check your email for confirmation or preference instructions. A request receipt does not activate a subscription or guarantee inbox delivery.</p><p>Reference: <code>{receipt.requestId}</code>; recorded {receipt.recordedAt}.</p><button disabled={fault} type="button" onClick={clear} className="rounded border px-3 py-2">Request fresh instructions</button></div> : <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={!ready || busy || !!pending || fault} className="space-y-3"><legend className="font-semibold">Newsletter email preference</legend>
        <label className="block">Email address<input name="newsletterEmail" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} className="block w-full rounded border bg-white px-4 py-3 text-gray-900" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" name="newsletterConsent" required checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Send me email instructions to subscribe or manage my newsletter preference. A new subscription requires my separate confirmation. An unfinished request is retained in this tab for exact retries.</span></label>
      </fieldset>
      {pending && <p>Original request: <code>{pending.requestId}</code>. Your email and consent remain unchanged for retry.</p>}
      <button disabled={!ready || busy || fault} type="submit" className="rounded bg-[#333e48] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Recording request…" : pending ? "Retry original newsletter request" : "Request newsletter instructions"}</button>
      {pending && editable && <button disabled={busy || fault} type="button" onClick={clear} className="ml-2 rounded border px-3 py-2">Edit rejected or exhausted request</button>}
    </form>}
  </div>;
}
