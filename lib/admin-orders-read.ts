import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { adminOrdersQuerySchema } from "@/lib/validations/collection-query";
import { protectedRead, readPagination } from "@/lib/protected-read";
import { purchasedProduct } from "@/lib/purchase-product-label";
function count(value: string | number) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw Error("Order summary could not be confirmed");
  return result;
}
export async function readAdminOrders(actor: AuthenticatedUser, raw: unknown) {
  const query = adminOrdersQuerySchema.parse(raw);
  const contains = { contains: query.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
  const search: Prisma.OrderWhereInput = query.q ? { OR: [
    { id: contains }, { trackingNumber: contains }, { fulfillments: { some: { trackingNumber: contains } } },
    { user: { OR: [{ name: contains }, { email: contains }, { phone: contains }] } },
    { items: { some: { OR: [{ productName: contains }, { productName: null, product: { name: contains } }] } } },
  ] } : {};
  const where: Prisma.OrderWhereInput = { ...search, ...(query.status === "ALL" ? {} : { status: query.status }) };
  return protectedRead(actor, { roles: ["ADMIN"], operation: "admin.orders" }, async (tx) => {
    const groups = await tx.order.groupBy({ by: ["status"], where: search, _count: { _all: true } });
    const counts = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
    const matchingAll = groups.reduce((sum, group) => sum + group._count._all, 0);
    const matchingCounts: Record<string, number> = { ...counts, ALL: matchingAll };
    const pagination = readPagination(query.status === "ALL" ? matchingAll : counts[query.status] ?? 0, query.page);
    const [row] = await tx.$queryRaw<{ orders: string; pending: string; delivered: string; net: string; partialCod: string }[]>`
      SELECT count(*)::text AS orders, count(*) FILTER(WHERE status IN ('PENDING','PROCESSING'))::text AS pending,
        count(*) FILTER(WHERE status='DELIVERED')::text AS delivered,
        COALESCE(sum(GREATEST(0,total*100-"refundedCents"-"disputeAmountCents")) FILTER(WHERE "paymentStatus"='PAID'),0)::text AS net,
        count(*) FILTER(WHERE "paymentMethod"='COD' AND "paymentStatus"<>'PAID' AND EXISTS(SELECT 1 FROM "OrderFulfillment" f WHERE f."orderId"=o.id AND f."codCollected"))::text AS "partialCod"
      FROM "Order" o`;
    const summary = { orders: count(row.orders), pending: count(row.pending), delivered: count(row.delivered), netFullyCollectedCents: count(row.net), partiallyCollectedCodOrders: count(row.partialCod) };
    const orders = await tx.order.findMany({ where, take: pagination.pageSize, skip: (query.page - 1) * pagination.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: {
      id: true, fulfillmentVersion: true, total: true, refundedCents: true, disputeAmountCents: true, status: true, paymentMethod: true, paymentStatus: true,
      shippingAddress: true, trackingNumber: true, shippingCarrier: true, shipmentTrackingNumber: true, createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: { select: { id: true, quantity: true, productName: true, productSlug: true, productSnapshotSource: true, price: true, product: { select: { id: true, name: true, imageUrl: true, price: true } } } },
    } });
    return { ...query, ...pagination, counts: matchingCounts, summary,
      orders: orders.map(({ refundedCents, disputeAmountCents, ...order }) => ({ ...order, total: Number(order.total), refundedAmount: count(refundedCents.toString()) / 100, disputeLossAmount: count(disputeAmountCents.toString()) / 100,
        items: order.items.map((item) => ({ ...item, price: Number(item.price), product: { ...purchasedProduct(item), price: Number(item.product.price) } })),
      })),
    };
  });
}
export type AdminOrdersPageData = Pick<Awaited<ReturnType<typeof readAdminOrders>>, "q" | "status" | "page" | "totalPages" | "total" | "counts" | "summary">;
