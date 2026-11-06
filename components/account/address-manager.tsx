"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSavedAddresses } from "@/hooks/use-saved-addresses";
import { shippingAddressSchema, MAX_SAVED_ADDRESSES, type SavedAddress, type ShippingAddress } from "@/lib/validations/address";
const empty: ShippingAddress = { fullName: "", phone: "", street: "", city: "", district: "", zipCode: "" };
export function AddressManager({ ownerId }: { ownerId: string }) {
  const [page, setPage] = useState(1), saved = useSavedAddresses(ownerId, page);
  const [fields, setFields] = useState<ShippingAddress>(empty), [editing, setEditing] = useState<SavedAddress | null>(null), [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [confirm, setConfirm] = useState<string | null>(null);
  const active = useRef(false);
  async function mutate(method: string, body: unknown) {
    if (active.current) return false;
    active.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/user/addresses", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok || !result.success) { setError(result.message || "Unable to save addresses."); return false; }
      saved.refresh(); setNotice(method === "DELETE" ? "Address removed. Your other saved addresses remain available." : "Address saved."); return true;
    } catch { setError("Could not confirm this address change. Reload saved addresses before retrying."); return false; }
    finally { active.current = false; setBusy(false); }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (active.current) return;
    const parsed = shippingAddressSchema.safeParse(fields); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check address fields."); return; }
    const body = editing ? { id: editing.id, version: editing.version, fields: parsed.data } : { fields: parsed.data, makeDefault };
    if (await mutate(editing ? "PUT" : "POST", body)) { setEditing(null); setFields(empty); setMakeDefault(false); }
  };
  return <main className="max-w-4xl mx-auto space-y-6"><h1 className="text-2xl font-bold">Saved shipping addresses</h1><p>Save up to 20 addresses. Your first address becomes the default. Removing a default selects your oldest remaining address.</p><Link href="/checkout" className="underline">Continue to checkout</Link>
    {saved.loading && <p role="status">Loading saved addresses...</p>}{saved.error && <p role="alert">{saved.error}</p>}<button type="button" disabled={busy || saved.loading} onClick={saved.refresh}>Reload saved addresses</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {saved.data && <><p>{saved.data.total} saved addresses</p><ul className="space-y-4">{saved.data.addresses.map((address) => <li key={address.id} className="border rounded p-4 space-y-2"><h2 className="font-bold">{address.fullName}{address.isDefault ? " (Default)" : ""}</h2><p>{address.phone}</p><p>{address.street}, {address.city}, {address.district} {address.zipCode}</p><div className="flex flex-wrap gap-4">
      <button type="button" disabled={busy || saved.loading} onClick={() => { setEditing(address); setFields({ fullName: address.fullName, phone: address.phone, street: address.street, city: address.city, district: address.district, zipCode: address.zipCode ?? "" }); setError(""); setNotice(""); }}>Edit address for {address.fullName}</button>
      {!address.isDefault && <button type="button" disabled={busy || saved.loading} onClick={() => void mutate("PATCH", { id: address.id, version: address.version })}>Make default for {address.fullName}</button>}
      <button type="button" disabled={busy || saved.loading} onClick={() => setConfirm(address.id)}>Remove address for {address.fullName}</button>
      {confirm === address.id && <><span>Remove this saved address?</span><button type="button" disabled={busy || saved.loading} onClick={async () => { if (await mutate("DELETE", { id: address.id, version: address.version })) { setConfirm(null); if (editing?.id === address.id) { setEditing(null); setFields(empty); } } }}>Confirm removal</button><button type="button" disabled={busy} onClick={() => setConfirm(null)}>Keep address</button></>}
    </div></li>)}</ul>{!saved.data.total && <p>No saved addresses. Enter your shipping details below.</p>}
      <nav aria-label="Saved address pages" className="flex gap-4"><button disabled={busy || saved.loading || page <= 1} onClick={() => setPage(page - 1)}>Previous addresses</button><span>Page {page} of {Math.max(1, saved.data.totalPages)}</span><button disabled={busy || saved.loading || page >= saved.data.totalPages} onClick={() => setPage(page + 1)}>Next addresses</button></nav></>}
    <form onSubmit={submit} className="space-y-3"><fieldset disabled={busy} className="space-y-3"><legend className="font-bold">{editing ? "Edit shipping address" : "Add shipping address"}</legend>
      {([['fullName','Full name',120],['phone','Phone number',30],['street','Street address',500],['city','City',100],['district','District / Division',100],['zipCode','Postal code (optional)',20]] as const).map(([field, label, maximum]) => <label key={field} className="block">{label}<input required={field !== "zipCode"} maxLength={maximum} autoComplete={field === "fullName" ? "name" : field === "phone" ? "tel" : field === "street" ? "street-address" : field === "zipCode" ? "postal-code" : "off"} value={fields[field] ?? ""} onChange={(event) => setFields({ ...fields, [field]: event.target.value })} className="block border rounded p-2 w-full" /></label>)}
      {!editing && <label className="block"><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} /> Make this my default address</label>}
      <button type="submit" disabled={busy || saved.loading || (!editing && (saved.data?.total ?? 0) >= MAX_SAVED_ADDRESSES)}>{busy ? "Saving..." : editing ? "Save address changes" : "Add address"}</button>{editing && <button type="button" onClick={() => { setEditing(null); setFields(empty); setError(""); }}>Cancel editing</button>}
    </fieldset></form>
  </main>;
}
