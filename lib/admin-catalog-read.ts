import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { adminCatalogQuerySchema } from "@/lib/validations/collection-query";
import { protectedRead, readPagination } from "@/lib/protected-read";
export async function readAdminCatalog(actor: AuthenticatedUser, raw: unknown) {
  const query = adminCatalogQuerySchema.parse(raw);
  // Prisma's contains uses PostgreSQL LIKE. Escape its metacharacters so the
  // operator searches literal product/seller text, including percent signs.
  const search = query.q.replace(/[\\%_]/g, "\\$&"), contains = { contains: search, mode: "insensitive" as const };
  const where: Prisma.ProductWhereInput = { ...(query.status === "ALL" ? {} : { status: query.status }), ...(query.q ? { OR: [{ id: query.q }, { name: contains }, { seller: { name: contains } }, { seller: { email: contains } }] } : {}) };
  return protectedRead(actor, { roles: ["ADMIN"], operation: "admin.catalog" }, async (tx) => {
    const total = await tx.product.count({ where }), pagination = readPagination(total, query.page);
    const products = await tx.product.findMany({ where, take: pagination.pageSize, skip: (query.page - 1) * pagination.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, name: true, price: true, discountPrice: true, stock: true, status: true, catalogVersion: true, specifications: true, category: { select: { name: true } }, seller: { select: { name: true, email: true } } } });
    return { ...query, ...pagination, products };
  });
}
