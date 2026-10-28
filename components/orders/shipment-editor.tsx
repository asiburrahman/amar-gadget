"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateShipmentDetails } from "@/server/actions/order/shipment-actions";

export function ShipmentEditor({ orderId, carrier, trackingNumber, editable }: { orderId: string; carrier: string | null; trackingNumber: string | null; editable: boolean }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState({ carrier, trackingNumber });
  if (!editable) return <p className="mt-2 text-xs">{saved.carrier && saved.trackingNumber ? `Shipment: ${saved.carrier} — ${saved.trackingNumber}` : "No carrier tracking recorded."}</p>;
  return <form className="mt-3 space-y-2" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await updateShipmentDetails({ orderId, carrier: data.get("carrier"), trackingNumber: data.get("trackingNumber") });
      if (result.success) { setSaved({ carrier: result.carrier, trackingNumber: result.trackingNumber }); setMessage("Shipment details saved."); }
      else setError(result.error);
    } catch { setError("Shipment details could not be saved. Please retry."); }
    finally { setBusy(false); }
  }}>
    <label className="block">Carrier<Input name="carrier" aria-label={`Carrier for ${orderId}`} required minLength={2} maxLength={80} defaultValue={carrier ?? ""} disabled={busy} /></label>
    <label className="block">Shipment tracking number<Input name="trackingNumber" aria-label={`Shipment tracking number for ${orderId}`} required minLength={2} maxLength={120} defaultValue={trackingNumber ?? ""} disabled={busy} /></label>
    <Button type="submit" variant="outline" disabled={busy}>{busy ? "Saving shipment…" : "Save shipment details"}</Button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </form>;
}
