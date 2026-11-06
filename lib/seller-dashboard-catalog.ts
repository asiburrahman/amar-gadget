import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { sellerDashboardCatalogQuerySchema } from "@/lib/validations/collection-query";
import { protectedRead, readPagination } from "@/lib/protected-read";

export async function readSellerDashboardCatalog(actor: AuthenticatedUser, raw: unknown) {
  const query = sellerDashboardCatalogQuerySchema.parse(raw);
  const contains = { contains: query.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
  const scope = { sellerId: actor.id };
  const where: Prisma.ProductWhereInput = {
    ...scope,
    ...(query.status === "ALL" ? {} : { status: query.status === "PENDING" ? "PENDING_APPROVAL" : "APPROVED" }),
    ...(query.q ? { OR: [{ id: query.q }, { name: contains }] } : {}),
  };
  return protectedRead(actor, { roles: ["MEMBER"], approvedSeller: true, operation: "seller.catalog" }, async (tx) => {
    const counts = {
      ALL: await tx.product.count({ where: scope }),
      APPROVED: await tx.product.count({ where: { ...scope, status: "APPROVED" } }),
      PENDING: await tx.product.count({ where: { ...scope, status: "PENDING_APPROVAL" } }),
    };
    const pagination = readPagination(await tx.product.count({ where }), query.page);
    const products = await tx.product.findMany({ where, take: pagination.pageSize, skip: (query.page - 1) * pagination.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: {
      id: true, name: true, price: true, stock: true, imageUrl: true, status: true, createdAt: true, category: { select: { name: true } },
    } });
    const seller = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, name: true, email: true, sellerStatus: true } });
    return { ...query, ...pagination, counts, products, seller };
  });
}
export type SellerDashboardCatalogPage = Pick<Awaited<ReturnType<typeof readSellerDashboardCatalog>>, "q" | "status" | "page" | "totalPages" | "total" | "counts">;
