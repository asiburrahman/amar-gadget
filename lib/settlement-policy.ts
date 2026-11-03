/** Integer-paisa accounting. These functions neither move money nor confirm a payout. */
import { AGGREGATE_ORDER_STATES } from "@/lib/fulfillment-policy";
export class SettlementError extends Error {
  constructor(message: string, readonly code = "SETTLEMENT_MONEY", readonly status = 409) { super(message); }
}
export type SettlementTerms = { commissionBps: number; shippingRecipient: "SELLER" | "PLATFORM" };
export function validateSettlementTerms(terms: SettlementTerms) {
  if (!Number.isInteger(terms.commissionBps) || terms.commissionBps < 0 || terms.commissionBps > 10_000 || !["SELLER", "PLATFORM"].includes(terms.shippingRecipient)) throw new SettlementError("Set a commission from 0 to 100 percent and choose the shipping recipient.", "SETTLEMENT_POLICY", 400);
  return terms;
}
function nonnegative(value: bigint) { if (typeof value !== "bigint" || value < BigInt(0)) throw new SettlementError("Settlement requires nonnegative integer-paisa purchase amounts."); return value; }
/** Round half up once per shipment's remaining goods; commission excludes shipping. */
export function commissionCents(goodsCents: bigint, basisPoints: number) {
  nonnegative(goodsCents); validateSettlementTerms({ commissionBps: basisPoints, shippingRecipient: "PLATFORM" });
  return (goodsCents * BigInt(basisPoints) + BigInt(5000)) / BigInt(10_000);
}
/** Stable ASCII IDs break equal-remainder ties. Never convert money to a float. */
export function allocateSettlementCents(total: bigint, weights: { id: string; weight: bigint }[]) {
  nonnegative(total);
  if (!weights.length || new Set(weights.map((entry) => entry.id)).size !== weights.length || weights.some((entry) => !/^[A-Za-z0-9:_-]{1,160}$/.test(entry.id))) throw new SettlementError("Settlement allocation requires distinct stable identifiers.");
  const sum = weights.reduce((amount, entry) => amount + nonnegative(entry.weight), BigInt(0));
  if (sum === BigInt(0) && total !== BigInt(0)) throw new SettlementError("A nonzero amount requires positive allocation weights.");
  const rows = weights.map((entry) => ({ id: entry.id, cents: sum ? total * entry.weight / sum : BigInt(0), remainder: sum ? total * entry.weight % sum : BigInt(0) }));
  const rest = Number(total - rows.reduce((amount, row) => amount + row.cents, BigInt(0)));
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < rest; index++) ranked[index].cents += BigInt(1);
  return rows.map(({ id, cents }) => ({ id, cents }));
}
export type SettlementShipmentInput = {
  id: string; sellerId: string; status: "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED"; codCollected: boolean;
  grossCents: bigint; netCents: bigint | null; retainedCents: bigint | null; terms: SettlementTerms | null;
};
export type SettlementOrderInput = {
  status: string; paymentMethod: "COD" | "STRIPE"; paymentStatus: string;
  goodsCents: bigint | null; shippingCents: bigint | null; shippingRefundedCents: bigint;
  refundState: string; financialReviewReason: string | null; reservationReviewReason: string | null;
  disputeStatus: "NONE" | "ACTIVE" | "WON" | "LOST"; disputeAmountCents: bigint;
};
export type SettlementHold = "POLICY_REQUIRED" | "PRICING_REQUIRED" | "FINANCIAL_REVIEW" | "REFUND_PENDING" | "DISPUTE_ACTIVE" | "DELIVERY_REQUIRED" | "COLLECTION_REQUIRED" | "CANCELLED";
/**
 * Original post-discount goods allocate shipping; an all-discounted order uses
 * original gross goods. Refunded shipping follows the same captured shares.
 * Known provider losses reduce remaining goods/shipping before commission.
 * Pending refund/dispute/review holds withdraw availability, without inventing
 * a refund or claiming the customer/seller received an external transfer.
 */
export function calculateSellerSettlement(order: SettlementOrderInput, shipments: SettlementShipmentInput[]) {
  if (!shipments.length || new Set(shipments.map((row) => row.id)).size !== shipments.length) throw new SettlementError("Settlement requires distinct captured seller shipments.");
  if (!(AGGREGATE_ORDER_STATES as readonly string[]).includes(order.status) || !["COD", "STRIPE"].includes(order.paymentMethod) || !["UNPAID", "PAID", "FAILED"].includes(order.paymentStatus) || !["NONE", "PENDING", "PARTIAL", "REFUNDED", "REVIEW"].includes(order.refundState) || !["NONE", "ACTIVE", "WON", "LOST"].includes(order.disputeStatus)) throw new SettlementError("Unknown order financial state requires reconciliation.");
  nonnegative(order.shippingRefundedCents); nonnegative(order.disputeAmountCents);
  for (const row of shipments) {
    if (!["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].includes(row.status)) throw new SettlementError("Unknown shipment state requires reconciliation.");
    nonnegative(row.grossCents);
    if (row.netCents !== null) { nonnegative(row.netCents); if (row.netCents > row.grossCents) throw new SettlementError("Discounted purchase value exceeds original goods."); }
    if (row.retainedCents !== null) { nonnegative(row.retainedCents); if (row.netCents === null || row.retainedCents > row.netCents) throw new SettlementError("Remaining goods exceed the captured purchase amount."); }
    if (row.terms) validateSettlementTerms(row.terms);
  }
  const pricingKnown = order.goodsCents !== null && order.shippingCents !== null && shipments.every((row) => row.netCents !== null && row.retainedCents !== null);
  if (order.goodsCents !== null) nonnegative(order.goodsCents);
  if (order.shippingCents !== null) { nonnegative(order.shippingCents); if (order.shippingRefundedCents > order.shippingCents) throw new SettlementError("Refunded shipping exceeds the captured shipping fee."); }
  if (pricingKnown && shipments.reduce((sum, row) => sum + row.netCents!, BigInt(0)) !== order.goodsCents) throw new SettlementError("Shipment values do not reconcile with the order's discounted goods.");
  const weights = shipments.map((row) => ({ id: row.id, weight: pricingKnown && order.goodsCents! > BigInt(0) ? row.netCents! : row.grossCents }));
  const originalShipping = new Map(allocateSettlementCents(pricingKnown ? order.shippingCents! : BigInt(0), weights).map((row) => [row.id, row.cents]));
  const shippingRemaining = new Map(allocateSettlementCents(pricingKnown ? order.shippingCents! - order.shippingRefundedCents : BigInt(0), shipments.map((row) => ({ id: row.id, weight: originalShipping.get(row.id)! }))).map((row) => [row.id, row.cents]));
  const components = shipments.flatMap((row) => [{ id: `${row.id}:GOODS`, weight: pricingKnown ? row.retainedCents! : BigInt(0) }, { id: `${row.id}:SHIPPING`, weight: shippingRemaining.get(row.id)! }]);
  const retainedTotal = components.reduce((sum, row) => sum + row.weight, BigInt(0)), loss = order.disputeAmountCents < retainedTotal ? order.disputeAmountCents : retainedTotal;
  const losses = new Map(allocateSettlementCents(loss, components).map((row) => [row.id, row.cents]));
  return {
    unallocatedDisputeLossCents: order.disputeAmountCents - loss,
    shipments: shipments.map((row) => {
      const goodsCents = (pricingKnown ? row.retainedCents! : BigInt(0)) - losses.get(`${row.id}:GOODS`)!, shippingCents = shippingRemaining.get(row.id)! - losses.get(`${row.id}:SHIPPING`)!;
      const feeCents = row.terms ? commissionCents(goodsCents, row.terms.commissionBps) : BigInt(0), potentialCents = row.terms ? goodsCents - feeCents + (row.terms.shippingRecipient === "SELLER" ? shippingCents : BigInt(0)) : BigInt(0);
      const holds: SettlementHold[] = [];
      if (!row.terms) holds.push("POLICY_REQUIRED"); if (!pricingKnown) holds.push("PRICING_REQUIRED");
      if (order.financialReviewReason || order.reservationReviewReason || order.refundState === "REVIEW") holds.push("FINANCIAL_REVIEW");
      if (order.refundState === "PENDING") holds.push("REFUND_PENDING"); if (order.disputeStatus === "ACTIVE") holds.push("DISPUTE_ACTIVE");
      if (order.status === "CANCELLED" || row.status === "CANCELLED") holds.push("CANCELLED"); else if (row.status !== "DELIVERED") holds.push("DELIVERY_REQUIRED");
      if (!(order.paymentMethod === "COD" ? row.codCollected : order.paymentStatus === "PAID")) holds.push("COLLECTION_REQUIRED");
      return { id: row.id, sellerId: row.sellerId, originalShippingCents: originalShipping.get(row.id)!, goodsCents, shippingCents, disputeLossCents: losses.get(`${row.id}:GOODS`)! + losses.get(`${row.id}:SHIPPING`)!, commissionCents: feeCents, potentialCents, availableCents: holds.length ? BigInt(0) : potentialCents, holds };
    }),
  };
}
