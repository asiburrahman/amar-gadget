import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { productMaintenanceMutationSchema, productMaintenanceQuerySchema } from "@/lib/validations/product-maintenance";
import { MAX_PRODUCT_STOCK } from "@/lib/catalog-constants";
import { productApprovalSchema } from "@/lib/validations/product";
import { isDeepStrictEqual } from "node:util";
export class ProductMaintenanceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
async function transaction<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient) => Promise<T>, requestId?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    if (requestId) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`amar.product-maintenance:${requestId}`},0))`;
    // Serialize owner changes and cleanup, while allowing checkout fulfillment
    // foreign-key KEY SHARE locks to finish without a product/user lock cycle.
    if (requestId) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR NO KEY UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, sellerStatus: true, isVerified: true, sessionVersion: true } });
    if (!current?.isVerified || current.role !== actor.role || !["MEMBER", "ADMIN"].includes(current.role) || current.sessionVersion !== actor.sessionVersion || (current.role === "MEMBER" && current.sellerStatus !== "APPROVED")) throw new ProductMaintenanceError("Approved catalog-owner access changed. Sign in again.", "PRODUCT_OWNER_CHANGED", 403);
    await tx.$queryRaw`SELECT set_config('amar.product_maintenance_actor_id',${actor.id},true)`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 5000, isolationLevel: requestId ? "ReadCommitted" : "RepeatableRead" });
}
const select = { id: true, name: true, slug: true, description: true, specifications: true, price: true, discountPrice: true, stock: true, imageUrl: true, images: true, isFeatured: true, status: true, catalogVersion: true, inventoryVersion: true, mediaVersion: true, categoryId: true, brandId: true, createdAt: true, category: { select: { name: true } }, brand: { select: { name: true } }, _count: { select: { orderItems: true } } } satisfies Prisma.ProductSelect;
type Row = Prisma.ProductGetPayload<{ select: typeof select }>;
const dto = (row: Row) => ({ ...row, price: Number(row.price), discountPrice: row.discountPrice === null ? null : Number(row.discountPrice), createdAt: row.createdAt.toISOString() });
type Result = { id: string; version: number; inventoryVersion: number; status: string; stock: number; action: string };
async function savedRecord(tx: Prisma.TransactionClient, ownerId: string, id: string) {
  const row = await tx.product.findFirst({ where: { id, sellerId: ownerId }, select });
  if (!row) throw new ProductMaintenanceError("Product not found in your catalog.", "PRODUCT_NOT_FOUND", 404); return row;
}
async function recordedResult(tx: Prisma.TransactionClient, ownerId: string, result: Result) {
  const row = await tx.product.findFirst({ where: { id: result.id, sellerId: ownerId }, select });
  return { result, row: row ? dto(row) : null, currentUnavailable: row === null };
}
export async function mutateProductMaintenance(actor: AuthenticatedUser, raw: unknown) {
  const input = productMaintenanceMutationSchema.parse(raw), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return transaction(actor, async (tx) => {
    const prior = await tx.productMaintenanceRequest.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.ownerId !== actor.id || prior.hash !== hash) throw new ProductMaintenanceError("This request identity belongs to different changes.", "PRODUCT_REQUEST_CONFLICT");
      return recordedResult(tx, actor.id, prior.result as unknown as Result);
    }
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${input.id} AND "sellerId"=${actor.id} FOR UPDATE`;
    const current = await savedRecord(tx, actor.id, input.id);
    if (current.catalogVersion !== input.version) throw new ProductMaintenanceError("This catalog record changed. Reload its current revision before deciding again.", "PRODUCT_CHANGED");
    await tx.$queryRaw`SELECT set_config('amar.product_maintenance_reason',${input.reason},true)`;
    let data: Prisma.ProductUpdateInput;
    if (input.action === "edit") {
      const previous = { name: current.name, description: current.description || null, specifications: current.specifications, price: Number(current.price), discountPrice: current.discountPrice === null ? null : Number(current.discountPrice), categoryId: current.categoryId, brandId: current.brandId };
      if (isDeepStrictEqual(previous, { ...input.fields, description: input.fields.description || null })) throw new ProductMaintenanceError("No catalog content changed. Use the separate inventory adjustment for stock changes.", "PRODUCT_NO_CHANGE", 400);
      const category = await tx.category.findUnique({ where: { id: input.fields.categoryId }, select: { id: true } });
      const brand = input.fields.brandId ? await tx.brand.findUnique({ where: { id: input.fields.brandId }, select: { id: true } }) : null;
      if (!category || (input.fields.brandId && !brand)) throw new ProductMaintenanceError("Choose an existing category and brand.", "PRODUCT_TAXONOMY", 400);
      const { categoryId, brandId, ...fields } = input.fields;
      data = { ...fields, category: { connect: { id: categoryId } }, brand: brandId ? { connect: { id: brandId } } : { disconnect: true }, status: current.status === "ARCHIVED" ? "ARCHIVED" : "PENDING_APPROVAL" };
    } else if (input.action === "stock") {
      if (current.inventoryVersion !== input.inventoryVersion) throw new ProductMaintenanceError("Available stock changed, possibly through checkout or a return. Reload before applying this inventory adjustment.", "PRODUCT_INVENTORY_CHANGED");
      const stock = current.stock + input.delta;
      if (stock < 0 || stock > MAX_PRODUCT_STOCK) throw new ProductMaintenanceError("The adjustment exceeds available stock or the supported inventory limit.", "PRODUCT_STOCK_RANGE", 400);
      data = { stock };
    } else if (input.action === "archive") {
      if (current.status === "ARCHIVED") throw new ProductMaintenanceError("This product is already archived.", "PRODUCT_NO_CHANGE", 400);
      data = { status: "ARCHIVED" };
    } else {
      if (!["ARCHIVED", "REJECTED"].includes(current.status)) throw new ProductMaintenanceError("Only an archived or rejected product needs explicit resubmission. Editing active content also sends it for review.", "PRODUCT_NO_CHANGE", 400);
      const valid = productApprovalSchema.safeParse({ name: current.name, description: current.description ?? undefined, specifications: current.specifications, price: Number(current.price), discountPrice: current.discountPrice === null ? null : Number(current.discountPrice), stock: current.stock, categoryId: current.categoryId, brandId: current.brandId, isFeatured: current.isFeatured, imageUrl: current.imageUrl, images: current.images });
      if (!valid.success) throw new ProductMaintenanceError("Correct this product's fields and saved cover/gallery before resubmitting it.", "PRODUCT_RESUBMIT_FIELDS", 400);
      data = { status: "PENDING_APPROVAL" };
    }
    const row = await tx.product.update({ where: { id: current.id }, data, select });
    const result: Result = { id: row.id, version: row.catalogVersion, inventoryVersion: row.inventoryVersion, status: row.status, stock: row.stock, action: input.action };
    await tx.productMaintenanceRequest.create({ data: { id: input.requestId, ownerId: actor.id, hash, result } }); return { result, row: dto(row), currentUnavailable: false };
  }, input.requestId);
}
export async function readProductMaintenance(actor: AuthenticatedUser, raw: unknown) {
  const input = productMaintenanceQuerySchema.parse(raw), limit = 12;
  return transaction(actor, async (tx) => {
    const prior = input.requestId ? await tx.productMaintenanceRequest.findFirst({ where: { id: input.requestId, ownerId: actor.id } }) : null;
    const attempt = prior ? prior.result as unknown as Result : null;
    const attemptRecord = attempt ? await tx.product.findFirst({ where: { id: attempt.id, sellerId: actor.id }, select }) : null;
    const attemptedRow = attemptRecord ? dto(attemptRecord) : null;
    if (input.mode === "history") {
      await savedRecord(tx, actor.id, input.id!);
      const where = { productId: input.id!, ownerId: actor.id }, total = await tx.productMaintenanceEvent.count({ where }), totalPages = Math.max(1, Math.ceil(total / 20));
      if (input.page > totalPages) throw new ProductMaintenanceError("This history page does not exist.", "PRODUCT_PAGE", 404);
      const rows = await tx.productMaintenanceEvent.findMany({ where, orderBy: { sequence: "desc" }, take: 20, skip: (input.page - 1) * 20 });
      return { ownerId: actor.id, rows: [], events: rows.map((row) => ({ ...row, sequence: row.sequence.toString(), createdAt: row.createdAt.toISOString() })), total, totalPages, page: input.page, attempt, attemptedRow };
    }
    const where: Prisma.ProductWhereInput = input.mode === "record" ? { id: input.id, sellerId: actor.id } : { sellerId: actor.id, ...(input.status !== "ALL" ? { status: input.status } : {}), OR: [{ name: { contains: input.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } }, { id: { equals: input.q } }] };
    const total = await tx.product.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
    if (input.page > totalPages) throw new ProductMaintenanceError("This catalog page does not exist.", "PRODUCT_PAGE", 404);
    if (input.mode === "record" && !total) throw new ProductMaintenanceError("Product not found in your catalog.", "PRODUCT_NOT_FOUND", 404);
    const rows = await tx.product.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, skip: (input.page - 1) * limit });
    return { ownerId: actor.id, rows: rows.map(dto), events: [], total, totalPages, page: input.page, attempt, attemptedRow };
  });
}
export type ProductMaintenanceView = Awaited<ReturnType<typeof readProductMaintenance>>;
export type ProductMaintenanceRow = ReturnType<typeof dto>;
