import { Prisma } from "@prisma/client";
/** Eligibility follows the purchased item's immutable shipment assignment.
 * Card money is provider-confirmed on the order; COD collection is recorded
 * for the delivered shipment. An unpaid sibling never qualifies this item. */
export const deliveredPaidItemWhere = {
  retainedQuantity: { gt: 0 }, OR: [{ netCents: null }, { netCents: 0 }, { retainedCents: { gt: 0 } }],
  fulfillment: { is: { status: "DELIVERED", OR: [
    { order: { is: { paymentMethod: "STRIPE", paymentStatus: "PAID", status: { not: "CANCELLED" }, financialReviewReason: null, disputeStatus: { in: ["NONE", "WON"] } } } },
    { codCollected: true, order: { is: { paymentMethod: "COD", status: { not: "CANCELLED" }, financialReviewReason: null, disputeStatus: { in: ["NONE", "WON"] } } } },
  ] } },
} satisfies Prisma.OrderItemWhereInput;
// The aliases f (shipment) and o (order) are fixed at each internal SQL call;
// no identifiers or predicates are interpolated from request input.
export function deliveredPaidItemSql(alias: "i" | "oi" = "i") {
  const retained = alias === "i" ? Prisma.sql`i."retainedQuantity">0 AND (i."netCents" IS NULL OR i."netCents"=0 OR i."retainedCents">0)` : Prisma.sql`oi."retainedQuantity">0 AND (oi."netCents" IS NULL OR oi."netCents"=0 OR oi."retainedCents">0)`;
  return Prisma.sql`${retained} AND f.status='DELIVERED' AND o.status<>'CANCELLED' AND o."financialReviewReason" IS NULL AND o."disputeStatus" IN ('NONE','WON') AND ((o."paymentMethod"='STRIPE' AND o."paymentStatus"='PAID') OR (o."paymentMethod"='COD' AND f."codCollected"))`;
}
export function isDeliveredPaidItem(item: { retainedQuantity?: number; netCents?: bigint | null; retainedCents?: bigint | null; fulfillment: { status: string; codCollected: boolean } | null; order: { status: string; paymentMethod: string; paymentStatus: string; financialReviewReason?: string | null; disputeStatus?: string } }) {
  return (item.retainedQuantity ?? 1) > 0 && (item.netCents == null || item.netCents === BigInt(0) || (item.retainedCents ?? BigInt(0)) > BigInt(0)) && !item.order.financialReviewReason && !["ACTIVE", "LOST"].includes(item.order.disputeStatus ?? "NONE") && item.order.status !== "CANCELLED" && item.fulfillment?.status === "DELIVERED" && (item.order.paymentMethod === "STRIPE" ? item.order.paymentStatus === "PAID" : item.order.paymentMethod === "COD" && item.fulfillment.codCollected);
}
