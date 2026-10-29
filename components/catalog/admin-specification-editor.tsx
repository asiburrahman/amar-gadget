"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { specificationsSchema } from "@/lib/validations/specifications";
import { SpecificationEditor } from "./specification-editor";
import { adminUpdateSpecifications } from "@/server/actions/product/specification-actions";

export function AdminSpecificationEditor({ productId, specifications }: { productId: string; specifications: unknown }) {
  const [items, setItems] = useState(() => specificationsSchema.parse(specifications));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const router = useRouter();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    const parsed = specificationsSchema.safeParse(items); setMessage("");
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check specifications."); return; }
    setBusy(true); setError("");
    try { const result = await adminUpdateSpecifications({ productId, specifications: parsed.data }); if (!result.success) setError(result.error ?? "Unable to save specifications."); else { setMessage("Specifications saved."); router.refresh(); } }
    catch { setError("Unable to save specifications. Try again."); } finally { setBusy(false); }
  };
  return <div><button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>Edit specifications</button>
    {open && <form onSubmit={submit} aria-label="Edit specifications" className="space-y-2"><SpecificationEditor value={items} onChange={setItems} disabled={busy} /><button type="submit" disabled={busy}>{busy ? "Saving..." : "Save specifications"}</button></form>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
