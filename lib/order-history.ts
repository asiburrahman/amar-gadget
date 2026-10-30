import type { OrderEvent } from "@prisma/client";

const statusLabels: Record<string, string> = {
  PENDING: "Pending", PROCESSING: "Processing", PARTIALLY_SHIPPED: "Partially shipped", SHIPPED: "Shipped", PARTIALLY_DELIVERED: "Partially delivered", DELIVERED: "Delivered", CANCELLED: "Order cancelled",
};
export function orderHistoryEntry(event: OrderEvent) {
  let step: string;
  if (event.kind === "ORDER_PLACED") step = "Order placed";
  else if (event.fulfillmentId) {
    const label = `Shipment ${event.fulfillmentId.slice(-8)}`;
    if (event.kind === "LEGACY_SHIPMENT_SNAPSHOT") step = `${label}: status at history activation (${statusLabels[event.fulfillmentStatus ?? ""] ?? "Unknown"})`;
    else if (event.kind === "VENDOR_COD_COLLECTED") step = `${label}: COD payment collected`;
    else if (event.kind === "VENDOR_SHIPMENT_UPDATED") step = `${label}: tracking details updated`;
    else if (event.kind === "VENDOR_SHIPMENT_CREATED") step = `${label}: assigned for fulfillment`;
    else step = `${label}: ${statusLabels[event.fulfillmentStatus ?? ""] ?? "Updated"}`;
  }
  else if (event.kind === "LEGACY_SNAPSHOT") step = `Status at history activation: ${statusLabels[event.status ?? ""] ?? event.status}`;
  else if (event.kind === "SHIPMENT_UPDATED") step = "Shipment details updated";
  else {
    const changes: string[] = [];
    if (event.previousStatus !== event.status) changes.push(statusLabels[event.status ?? ""] ?? `Status: ${event.status}`);
    if (event.previousPaymentStatus !== event.paymentStatus) changes.push(event.paymentStatus === "PAID" ? "Payment confirmed" : event.paymentStatus === "FAILED" ? "Payment failed" : `Payment: ${event.paymentStatus}`);
    step = changes.join(" · ");
  }
  return {
    id: event.id, step, date: event.occurredAt?.toISOString() ?? null,
    recordedAt: event.recordedAt.toISOString(),
    carrier: event.shippingCarrier, shipmentTrackingNumber: event.shipmentTrackingNumber,
  };
}
