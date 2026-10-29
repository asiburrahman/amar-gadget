import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { resolveCatalogBrand } from "@/lib/catalog-brand-filter";
import { resolveCatalogCategory } from "@/lib/catalog-category-filter";
import { catalogQuerySchema, type CatalogQuery } from "@/lib/validations/catalog-query";

export class CatalogQueryError extends Error {
  constructor(message: string, readonly code = "INVALID_QUERY") { super(message); }
}
export class CatalogAccessError extends Error {}
export type CatalogScope = { kind: "public" } | { kind: "admin" | "seller"; status: "PENDING_APPROVAL" | "REJECTED"; actorId: string; sessionVersion: number };
type Taxonomy = { id: string; name: string; slug: string };
type CatalogRow = {
  id: string; slug: string; name: string; description: string | null; price: Prisma.Decimal; discountPrice: Prisma.Decimal | null;
  stock: number; imageUrl: string | null; images: string[]; rating: number; reviewCount: number; isFeatured: boolean; status: string;
  categoryId: string; brandId: string | null; sellerId: string; createdAt: Date; updatedAt: Date;
  category: Taxonomy; brand: (Taxonomy & { logo: string | null }) | null; seller: { id: string; name: string | null };
  effectivePrice: Prisma.Decimal; unitsSold: bigint;
};
const effectivePrice = Prisma.sql`COALESCE(p."discountPrice", p.price)`;
const from = Prisma.sql`FROM "Product" p JOIN "User" u ON u.id = p."sellerId" JOIN "Category" c ON c.id = p."categoryId" LEFT JOIN "Brand" b ON b.id = p."brandId"`;
const searchPattern = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

const runListing = cache(async (serialized: string, serializedScope: string) => {
  const query = JSON.parse(serialized) as CatalogQuery;
  const scope = JSON.parse(serializedScope) as CatalogScope;
  if (scope.kind === "public" && query.status && query.status !== "APPROVED") throw new CatalogQueryError("This endpoint lists approved products only.", "INVALID_STATUS");
  if (scope.kind !== "public" && query.status !== scope.status) throw new CatalogAccessError("Unauthorized");
  const [brandFilter, categoryFilter] = await Promise.all([resolveCatalogBrand(query.brand, query.brandId), resolveCatalogCategory(query.category, query.categoryId)]);
  if (brandFilter.state === "invalid") throw new CatalogQueryError(brandFilter.message, "INVALID_BRAND");
  if (categoryFilter.state === "invalid") throw new CatalogQueryError(categoryFilter.message, "INVALID_CATEGORY");
  const empty = { products: [], total: 0, page: query.page, limit: query.limit, totalPages: 0, outOfRange: false, query, brandFilter, categoryFilter };
  // Private scopes must be checked before any empty/missing short circuit.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
    const predicates: Prisma.Sql[] = [];
    if (scope.kind === "public") predicates.push(Prisma.sql`p.status = ${publicProductWhere.status} AND u."sellerStatus" = ${publicProductWhere.seller.sellerStatus}`);
    else {
      const actor = await tx.user.findUnique({ where: { id: scope.actorId }, select: { role: true, sellerStatus: true, isVerified: true, sessionVersion: true } });
      if (!actor?.isVerified || actor.sessionVersion !== scope.sessionVersion || (scope.kind === "admin" ? actor.role !== "ADMIN" : actor.role !== "MEMBER" || actor.sellerStatus !== "APPROVED")) throw new CatalogAccessError("Unauthorized");
      predicates.push(Prisma.sql`p.status = ${scope.status}`);
      if (scope.kind === "seller") predicates.push(Prisma.sql`p."sellerId" = ${scope.actorId}`);
    }
    if (brandFilter.state === "missing" || categoryFilter.state === "missing") return empty;
    if (brandFilter.state === "found") predicates.push(Prisma.sql`p."brandId" = ${brandFilter.brand.id}`);
    if (categoryFilter.state === "found") predicates.push(Prisma.sql`p."categoryId" = ${categoryFilter.category.id}`);
    if (query.search) {
      const pattern = searchPattern(query.search);
      predicates.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.description ILIKE ${pattern} OR c.name ILIKE ${pattern})`);
    }
    if (query.minPrice !== undefined) predicates.push(Prisma.sql`${effectivePrice} >= ${query.minPrice}`);
    if (query.maxPrice !== undefined) predicates.push(Prisma.sql`${effectivePrice} <= ${query.maxPrice}`);
    if (query.filter === "sale") predicates.push(Prisma.sql`p."discountPrice" > 0 AND p."discountPrice" < p.price`);
    const where = Prisma.sql`WHERE ${Prisma.join(predicates, " AND ")}`;
    const counts = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total ${from} ${where}`;
    const total = Number(counts[0].total);
    if (!Number.isSafeInteger(total)) throw new Error("Catalog count exceeds the supported numeric range");
    const totalPages = Math.ceil(total / query.limit);
    if (query.page > Math.max(1, totalPages)) return { ...empty, total, totalPages, outOfRange: true };
    if (!total) return empty;
    const sales = query.sort === "bestsellers" ? Prisma.sql`LEFT JOIN LATERAL (SELECT sum(oi.quantity)::bigint AS units FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" WHERE oi."productId" = p.id AND o.status = 'DELIVERED' AND o."paymentStatus" = 'PAID') sold ON true` : Prisma.empty;
    const units = query.sort === "bestsellers" ? Prisma.sql`COALESCE(sold.units, 0)::bigint` : Prisma.sql`0::bigint`;
    const ordering = {
      latest: Prisma.sql`p."createdAt" DESC, p.id ASC`,
      price_low: Prisma.sql`${effectivePrice} ASC, p."createdAt" DESC, p.id ASC`,
      price_high: Prisma.sql`${effectivePrice} DESC, p."createdAt" DESC, p.id ASC`,
      rating: Prisma.sql`p.rating DESC, p."reviewCount" DESC, p."createdAt" DESC, p.id ASC`,
      bestsellers: Prisma.sql`${units} DESC, p."createdAt" DESC, p.id ASC`,
    }[query.sort];
    const rows = await tx.$queryRaw<CatalogRow[]>`SELECT p.*, ${effectivePrice} AS "effectivePrice", ${units} AS "unitsSold", json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS category, CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'logo', b.logo) END AS brand, json_build_object('id', u.id, 'name', u.name) AS seller ${from} ${sales} ${where} ORDER BY ${ordering} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
    return { ...empty, total, totalPages, products: rows.map((row) => ({ ...row, price: Number(row.price), discountPrice: row.discountPrice === null ? null : Number(row.discountPrice), effectivePrice: Number(row.effectivePrice), unitsSold: query.sort === "bestsellers" ? row.unitsSold.toString() : undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
});

export async function getCatalogListing(input: unknown, scope: CatalogScope = { kind: "public" }) {
  const parsed = catalogQuerySchema.safeParse(input);
  if (!parsed.success) {
    const path = String(parsed.error.issues[0]?.path[0] ?? "query");
    const code = path.startsWith("brand") ? "INVALID_BRAND" : path.startsWith("category") ? "INVALID_CATEGORY" : "INVALID_QUERY";
    throw new CatalogQueryError(`Invalid ${path}: ${parsed.error.issues[0]?.message ?? "check the catalog filters."}`, code);
  }
  return runListing(JSON.stringify(parsed.data), JSON.stringify(scope));
}
export type CatalogListing = Awaited<ReturnType<typeof getCatalogListing>>;
export type CatalogProduct = CatalogListing["products"][number];
