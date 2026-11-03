"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormInput } from "@/components/shared/form-input";
import { SUPPORT_TOPICS, supportSubmissionSchema, type SupportSubmission } from "@/lib/validations/support";

const key = "amar:contact-submission:v1";
type Fields = { name: string; email: string; topic: typeof SUPPORT_TOPICS[number]; subject: string; orderReference: string; message: string; consent: boolean };
const empty: Fields = { name: "", email: "", topic: "ORDER", subject: "", orderReference: "", message: "", consent: false };
type Receipt = { id: string; receivedAt: string };
function savedReceipt(value: unknown): Receipt {
  if (!value || typeof value !== "object" || !("id" in value) || !("receivedAt" in value) || typeof value.id !== "string" || !/^[\da-f-]{36}$/i.test(value.id) || typeof value.receivedAt !== "string" || !Number.isFinite(Date.parse(value.receivedAt))) throw Error("The saved receipt could not be confirmed. Retry the same message.");
  return { id: value.id, receivedAt: value.receivedAt };
}

export function ContactForm() {
  const [fields, setFields] = useState<Fields>(empty), [pending, setPending] = useState<SupportSubmission | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [fault, setFault] = useState(false), [rejected, setRejected] = useState(false);
  const active = useRef(false), working = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true; let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
          const saved = JSON.parse(stored);
          if (saved.receipt) setReceipt(savedReceipt(saved.receipt));
          else {
            const intent = supportSubmissionSchema.parse(saved.intent);
            setPending(intent); setFields({ ...intent, orderReference: intent.orderReference ?? "" });
          }
        }
      } catch { setFault(true); setError("The saved submission cannot be read safely. Recover your original reference before sending another message from this tab."); }
      setReady(true);
    });
    return () => { cancelled = true; active.current = false; controller.current?.abort(); };
  }, []);
  function store(value: unknown) {
    const serialized = JSON.stringify(value); sessionStorage.setItem(key, serialized);
    if (sessionStorage.getItem(key) !== serialized) throw Error("The submission could not be saved in this tab. No new request was sent.");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || working.current || fault || receipt) return;
    working.current = true; setBusy(true); setError(""); setRejected(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = pending ?? supportSubmissionSchema.parse({ ...fields, orderReference: fields.orderReference.trim() || undefined, requestId: crypto.randomUUID() });
      if (!pending) {
        try { store({ intent: input }); } catch { throw Error("This browser cannot preserve the submission for an exact retry. Enable session storage before sending."); }
        setPending(input);
      }
      const request = new AbortController(); controller.current = request; timeout = setTimeout(() => request.abort(), 30_000);
      const response = await fetch("/api/contact", { method: "POST", cache: "no-store", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      let body;
      try { body = await response.json(); } catch { throw Error("Receipt was not confirmed. Keep the original message and retry it unchanged."); }
      if (!active.current || request.signal.aborted) return;
      if (!response.ok || body?.success !== true) {
        if (response.status === 400 || response.status === 413 || response.status === 415) setRejected(true);
        throw Error(typeof body?.message === "string" ? body.message : "Receipt was not confirmed. Retry the same message later.");
      }
      const result = savedReceipt(body.receipt);
      if (result.id !== input.requestId) throw Error("The receipt reference does not match this submission. Retry the original message.");
      if (!active.current) return;
      try { store({ receipt: result }); }
      catch { setFault(true); setError("Your message is saved, but this tab could not replace its local retry record. Keep the receipt; reload to recover it before another submission."); }
      setReceipt(result); setPending(null); setFields(empty);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error && cause.name !== "AbortError" ? (cause.name === "ZodError" ? "Check all required fields, consent and length limits before sending." : cause.message) : "Receipt was not confirmed. Retry the same message; its reference is preserved.");
    } finally { if (timeout) clearTimeout(timeout); controller.current = null; working.current = false; if (active.current) setBusy(false); }
  }
  function clearConfirmed() {
    try {
      sessionStorage.removeItem(key); if (sessionStorage.getItem(key) !== null) throw Error("Saved record remains");
      setReceipt(null); setPending(null); setRejected(false); setError("");
    } catch { setFault(true); setError("This tab could not clear its saved record. Keep your receipt and reload before another submission."); }
  }
  const locked = !ready || busy || !!pending || !!receipt || fault;
  const change = (name: keyof Fields, value: string | boolean) => setFields((current) => ({ ...current, [name]: value }));
  return <div className="space-y-4">
    <p>Messages are saved for administrator review. A receipt confirms storage; it does not confirm an email reply or a response deadline.</p>
    <p className="text-sm text-muted-foreground">Do not include passwords, card details, identity documents or payment credentials. An order reference helps describe your inquiry and does not grant access to an order.</p>
    {!ready && <p role="status">Checking this tab for an unfinished submission…</p>}
    {error && <p role="alert">{error}</p>}
    {receipt && <div role="status" className="rounded border p-4 space-y-2"><h3 className="font-semibold">Message received</h3><p>Receipt: <code>{receipt.id}</code></p><p>Received: {receipt.receivedAt}</p><p>Keep this reference when following up. A reply has not been sent by this form.</p><button type="button" disabled={fault} onClick={clearConfirmed} className="rounded border px-3 py-2">Write another message</button></div>}
    {!receipt && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={locked} className="space-y-4">
        <legend className="font-semibold">Your message</legend>
        <FormInput name="name" label="Your name" autoComplete="name" minLength={2} maxLength={100} required value={fields.name} onChange={(event) => change("name", event.target.value)} />
        <FormInput name="email" label="Contact email" type="email" autoComplete="email" maxLength={254} required value={fields.email} onChange={(event) => change("email", event.target.value)} />
        <label className="block">Topic<select name="topic" value={fields.topic} onChange={(event) => change("topic", event.target.value)} className="block rounded border p-2">{SUPPORT_TOPICS.map((topic) => <option key={topic} value={topic}>{topic === "ORDER" ? "Order inquiry" : topic === "WARRANTY" ? "Warranty inquiry" : topic === "SELLER" ? "Seller inquiry" : "Other"}</option>)}</select></label>
        <FormInput name="subject" label="Subject" minLength={3} maxLength={160} required value={fields.subject} onChange={(event) => change("subject", event.target.value)} />
        <FormInput name="orderReference" label="Order reference (optional)" maxLength={120} value={fields.orderReference} onChange={(event) => change("orderReference", event.target.value)} />
        <label className="block">Message<textarea name="message" rows={7} minLength={10} maxLength={8000} required value={fields.message} onChange={(event) => change("message", event.target.value)} className="block w-full rounded border bg-background p-3" /></label>
        <label className="flex items-start gap-2"><input name="consent" type="checkbox" required checked={fields.consent} onChange={(event) => change("consent", event.target.checked)} /><span>I agree to storing my message and contact details for handling this inquiry. This does not subscribe me to marketing. An unfinished submission is kept in this browser tab for exact retries.</span></label>
      </fieldset>
      {pending && <p>Submission reference: <code>{pending.requestId}</code>. The original details are locked until the saved receipt is confirmed.</p>}
      <button type="submit" disabled={!ready || busy || fault} className="rounded bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{busy ? "Confirming receipt…" : pending ? "Retry the same message" : "Send message"}</button>
      {rejected && pending && <button type="button" disabled={busy || fault} onClick={clearConfirmed} className="ml-3 rounded border px-3 py-2">Edit rejected message</button>}
    </form>}
  </div>;
}
