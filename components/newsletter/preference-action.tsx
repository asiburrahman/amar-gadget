"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { newsletterTokenSchema } from "@/lib/validations/newsletter";

export function NewsletterPreferenceAction({ action }: { action: "confirm" | "unsubscribe" }) {
  const [ready, setReady] = useState(false), [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const token = useRef<string | null>(null), revision = useRef(0), active = useRef(false), working = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true; let cancelled = false;
    function capture(fresh = false) {
      // StrictMode replay retains the already-captured in-memory capability.
      // A new email fragment in this same browser page replaces it explicitly.
      if (fresh) { revision.current++; controller.current?.abort(); controller.current = null; working.current = false; token.current = null; }
      if (!token.current) {
        const params = new URLSearchParams(window.location.hash.slice(1)), candidate = params.get("token");
        const valid = params.getAll("token").length === 1 && [...params.keys()].every((key) => key === "token") && newsletterTokenSchema.safeParse(candidate).success;
        if (valid) token.current = candidate;
      }
      let cleared = false;
      try { window.history.replaceState(window.history.state, "", window.location.pathname); cleared = true; }
      catch { token.current = null; }
      queueMicrotask(() => { if (!cancelled) { if (fresh) { setBusy(false); setDone(false); setError(""); } setAvailable(!!token.current && cleared); setReady(true); } });
    }
    const changed = () => capture(true); capture(); window.addEventListener("hashchange", changed);
    return () => { cancelled = true; active.current = false; controller.current?.abort(); window.removeEventListener("hashchange", changed); };
  }, []);
  async function apply() {
    if (!ready || !available || !token.current || working.current || done) return;
    working.current = true; setBusy(true); setError(""); const requestRevision = revision.current, request = new AbortController(); controller.current = request; const timeout = setTimeout(() => request.abort(), 30_000);
    try {
      const response = await fetch(`/api/newsletter/${action}`, { method: "POST", cache: "no-store", signal: request.signal, referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.current }) });
      let value;
      try { value = await response.json(); } catch { throw Error("The preference response could not be read. Retry this same action; your preference has not been confirmed here."); }
      if (!active.current || request.signal.aborted || requestRevision !== revision.current) return;
      if (!response.ok || value?.success !== true) throw Error(typeof value?.message === "string" ? value.message : "This preference change was not confirmed. Retry later.");
      token.current = null; setDone(true); setAvailable(false);
    } catch (cause) { if (active.current && requestRevision === revision.current) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "The preference change was not confirmed. Retry the same action."); }
    finally { clearTimeout(timeout); if (controller.current === request) { working.current = false; controller.current = null; if (active.current) setBusy(false); } }
  }
  return <div className="space-y-4">
    {!ready && <p role="status">Reading the private newsletter link…</p>}
    {ready && !available && !done && <p role="alert">This page needs the complete link from your email. Open that link again, or request fresh instructions below.</p>}
    {error && <p role="alert">{error}</p>}
    {done ? <p role="status">{action === "confirm" ? "Your newsletter subscription is confirmed." : "Your newsletter consent is withdrawn. A later subscription requires fresh email confirmation."}</p> : <><p>{action === "confirm" ? "Select Confirm subscription to agree to Amar Gadget product news and offers by email. You can unsubscribe at any time." : "Select Unsubscribe to withdraw newsletter consent. This action does not change your store account or orders."}</p><button type="button" disabled={!ready || !available || busy} onClick={() => void apply()} className="rounded bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{busy ? "Saving preference…" : action === "confirm" ? "Confirm subscription" : "Unsubscribe"}</button></>}
    <Link href="/newsletter" className="block underline">Request fresh newsletter instructions</Link>
  </div>;
}
