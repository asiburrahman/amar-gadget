export const FULFILLMENT_STATES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type FulfillmentState = typeof FULFILLMENT_STATES[number];
export const AGGREGATE_ORDER_STATES = ["PENDING", "PROCESSING", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_DELIVERED", "DELIVERED", "CANCELLED"] as const;
export type AggregateOrderState = typeof AGGREGATE_ORDER_STATES[number];
export class FulfillmentError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
/** Cancellation is currently order-wide and pre-shipment. Partial refunds
 * and returns have their own AUD-015 policy; they must not masquerade as a
 * delivered or cancelled shipment here. */
export function aggregateFulfillmentState(states: readonly string[]): AggregateOrderState {
  if (!states.length || states.some((state) => !FULFILLMENT_STATES.includes(state as FulfillmentState))) throw new FulfillmentError("The shipment assignments need operator review.", "FULFILLMENT_INCOMPLETE", 503);
  if (states.every((state) => state === "CANCELLED")) return "CANCELLED";
  if (states.some((state) => state === "CANCELLED")) throw new FulfillmentError("Mixed cancelled shipments require reconciliation.", "FULFILLMENT_RECONCILIATION", 503);
  if (states.every((state) => state === "DELIVERED")) return "DELIVERED";
  if (states.some((state) => state === "DELIVERED")) return "PARTIALLY_DELIVERED";
  if (states.every((state) => state === "SHIPPED")) return "SHIPPED";
  if (states.some((state) => state === "SHIPPED")) return "PARTIALLY_SHIPPED";
  if (states.every((state) => state === "PENDING")) return "PENDING";
  return "PROCESSING";
}
export const fulfillmentStatusLabel = (state: string) => ({ PENDING: "Pending confirmation", PROCESSING: "Preparing shipment", PARTIALLY_SHIPPED: "Partially shipped", SHIPPED: "Shipped", PARTIALLY_DELIVERED: "Partially delivered", DELIVERED: "Delivered", CANCELLED: "Cancelled" }[state] ?? "Needs review");
export function fulfillmentCounts(states: readonly string[]) {
  return { total: states.length, pending: states.filter((x) => x === "PENDING").length, processing: states.filter((x) => x === "PROCESSING").length, shipped: states.filter((x) => x === "SHIPPED").length, delivered: states.filter((x) => x === "DELIVERED").length, cancelled: states.filter((x) => x === "CANCELLED").length };
}
