"use client";
import { FulfillmentConsole } from "@/components/orders/fulfillment-console";
import { useState } from "react";
/** Tracking belongs to a vendor's package, including single-vendor orders. */
export function ShipmentEditor({ orderId }: { orderId: string; carrier?: string | null; trackingNumber?: string | null; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-3" onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-primary">Manage vendor shipments</summary>{open && <FulfillmentConsole role="ADMIN" orderId={orderId} />}</details>;
}
