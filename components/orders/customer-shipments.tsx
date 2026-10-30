import type { CustomerFulfillment } from "@/lib/validations/fulfillment";
import { fulfillmentStatusLabel } from "@/lib/fulfillment-policy";
export function CustomerShipments({ shipments, items = [] }: { shipments?: CustomerFulfillment[]; items?: { id: string; quantity: number; product: { name: string } }[] }) {
  if (!shipments?.length) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const delivered = shipments.filter((row) => row.status === "DELIVERED").length;
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Seller shipments">
    <h2 className="font-bold">Seller shipments</h2>
    <p className="text-sm">{delivered} of {shipments.length} shipments delivered. Each package has its own status and tracking details.</p>
    <div className="grid gap-3 sm:grid-cols-2">{shipments.map((row, index) => <article key={row.id} className="space-y-2 rounded-lg border p-3 text-sm">
      <h3 className="font-semibold">Shipment {index + 1}: {fulfillmentStatusLabel(row.status)}</h3>
      <ul>{row.itemIds.map((id) => { const item = byId.get(id); return item ? <li key={id}>{item.product.name} × {item.quantity}</li> : null; })}</ul>
      {row.carrier && <p>Carrier: {row.carrier}</p>}{row.trackingNumber && <p className="break-all">Package tracking: {row.trackingNumber}</p>}
      {row.shippedAt && <p>Shipped: <time dateTime={row.shippedAt}>{new Date(row.shippedAt).toLocaleString("en-BD")}</time></p>}
      {row.deliveredAt && <p>Delivered: <time dateTime={row.deliveredAt}>{new Date(row.deliveredAt).toLocaleString("en-BD")}</time></p>}
      {row.legacySnapshot && ((row.status === "SHIPPED" && !row.shippedAt) || (row.status === "DELIVERED" && !row.deliveredAt)) && <p className="text-muted-foreground">Earlier status retained; its transition time was not recorded.</p>}
    </article>)}</div>
  </section>;
}
