import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { customerShipmentSelect } from "@/lib/fulfillments";
import { customerOrdersQuerySchema } from "@/lib/validations/collection-query";
import { protectedRead, readPagination } from "@/lib/protected-read";

export async function readCustomerOrders(actor: AuthenticatedUser, raw: unknown) {
  const query = customerOrdersQuerySchema.parse(raw);
  const contains = { contains: query.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
  const scope: Prisma.OrderWhereInput = {
    userId: actor.id,
    ...(query.q ? { OR: [
      { id: contains }, { trackingNumber: contains },
      { fulfillments: { some: { trackingNumber: contains } } },
      // Search the immutable purchased label; only legacy null snapshots use
      // today's product label, matching the history's display rule.
      { items: { some: { OR: [{ productName: contains }, { productName: null, product: { name: contains } }] } } },
    ] } : {}),
  };
  const statuses: Record<typeof query.status, Prisma.OrderWhereInput> = {
    ALL: {}, ACTIVE: { status: { notIn: ["DELIVERED", "CANCELLED"] } },
    DELIVERED: { status: "DELIVERED" }, CANCELLED: { status: "CANCELLED" },
  };
  return protectedRead(actor, { roles: ["USER", "MEMBER", "ADMIN"], operation: "customer.orders" }, async (tx) => {
    const counts = {
      ALL: await tx.order.count({ where: scope }),
      ACTIVE: await tx.order.count({ where: { AND: [scope, statuses.ACTIVE] } }),
      DELIVERED: await tx.order.count({ where: { AND: [scope, statuses.DELIVERED] } }),
      CANCELLED: await tx.order.count({ where: { AND: [scope, statuses.CANCELLED] } }),
    };
    const pagination = readPagination(counts[query.status], query.page);
    const orders = await tx.order.findMany({
      where: { AND: [scope, statuses[query.status]] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: pagination.pageSize, skip: (query.page - 1) * pagination.pageSize,
      include: {
        fulfillments: { where: { items: { some: {} } }, orderBy: { id: "asc" }, select: customerShipmentSelect },
        items: { include: { product: { select: { id: true, name: true, imageUrl: true, slug: true } } } },
      },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, name: true, email: true } });
    return { ...query, ...pagination, counts, orders, user };
  });
}
