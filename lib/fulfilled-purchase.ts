import { Prisma } from "@prisma/client";
/** Eligibility follows the purchased item's immutable shipment assignment.
 * Card money is provider-confirmed on the order; COD collection is recorded
 * for the delivered shipment. An unpaid sibling never qualifies this item. */
export const deliveredPaidItemWhere = {
  fulfillment: { is: { status: "DELIVERED", OR: [
    { order: { is: { paymentMethod: "STRIPE", paymentStatus: "PAID", status: { not: "CANCELLED" } } } },
    { codCollected: true, order: { is: { paymentMethod: "COD", status: { not: "CANCELLED" } } } },
  ] } },
} satisfies Prisma.OrderItemWhereInput;
// The aliases f (shipment) and o (order) are fixed at each internal SQL call;
// no identifiers or predicates are interpolated from request input.
export const deliveredPaidItemSql = Prisma.sql`f.status='DELIVERED' AND o.status<>'CANCELLED' AND ((o."paymentMethod"='STRIPE' AND o."paymentStatus"='PAID') OR (o."paymentMethod"='COD' AND f."codCollected"))`;
export function isDeliveredPaidItem(item: { fulfillment: { status: string; codCollected: boolean } | null; order: { status: string; paymentMethod: string; paymentStatus: string } }) {
  return item.order.status !== "CANCELLED" && item.fulfillment?.status === "DELIVERED" && (item.order.paymentMethod === "STRIPE" ? item.order.paymentStatus === "PAID" : item.order.paymentMethod === "COD" && item.fulfillment.codCollected);
}
