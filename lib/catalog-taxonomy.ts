import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { taxonomyMutationSchema, taxonomyQuerySchema, type TaxonomyMutation } from "@/lib/validations/taxonomy";
import { productMediaStore } from "@/lib/cloudflare/r2";
import { imageKeyOwner } from "@/lib/product-image-keys";
import { enqueueDetachedImages } from "@/lib/product-image-lifecycle";

export class TaxonomyError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
type Result = { kind: "category" | "brand"; id: string; version: number; deleted: boolean };
type Row = { id: string; name: string; slug: string; image: string | null; parentId: string | null; parentName: string | null; path: string[]; version: number; productsCount: bigint; childrenCount: bigint };
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, write = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    if (write) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('amar.catalog-taxonomy.v1',0))`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 5000, isolationLevel: write ? "ReadCommitted" : "RepeatableRead" });
}
async function authority(tx: Prisma.TransactionClient, actor: AuthenticatedUser, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`; else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
  if (actor.role !== "ADMIN" || !current?.isVerified || current.role !== "ADMIN" || current.sessionVersion !== actor.sessionVersion) throw new TaxonomyError("Your administrator account changed. Reload your session.", "TAXONOMY_ACCOUNT_CHANGED", 403);
  await tx.$queryRaw`SELECT set_config('amar.taxonomy_actor_id',${actor.id},true)`;
}
function count(value: bigint) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error("Taxonomy count exceeds the supported range"); return result; }
async function recorded(tx: Prisma.TransactionClient, actor: AuthenticatedUser, input: TaxonomyMutation, hash: string) {
  const prior = await tx.taxonomyRequest.findUnique({ where: { id: input.requestId } });
  if (!prior) return null;
  if (prior.ownerId !== actor.id || prior.hash !== hash) throw new TaxonomyError("This request identity belongs to different changes.", "TAXONOMY_REQUEST_CONFLICT");
  return prior.result as unknown as Result;
}
async function lockRecord(tx: Prisma.TransactionClient, kind: "category" | "brand", id: string, version: number) {
  const table = kind === "category" ? Prisma.sql`"Category"` : Prisma.sql`"Brand"`;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${table} WHERE id=${id} FOR UPDATE`);
  const row = kind === "category" ? await tx.category.findUnique({ where: { id } }) : await tx.brand.findUnique({ where: { id } });
  if (!row) throw new TaxonomyError("The catalog record no longer exists. Reload the list.", "TAXONOMY_NOT_FOUND", 404);
  if (row.version !== version) throw new TaxonomyError("This catalog record changed. Reload before retrying.", "TAXONOMY_CHANGED");
  return row;
}
async function parent(tx: Prisma.TransactionClient, parentId: string | null, id: string) {
  if (!parentId) return;
  if (!await tx.category.findUnique({ where: { id: parentId }, select: { id: true } })) throw new TaxonomyError("Select an existing parent category.", "TAXONOMY_PARENT", 400);
  const [cycle] = await tx.$queryRaw<{ found: boolean }[]>`WITH RECURSIVE ancestry AS (SELECT id,"parentId" FROM "Category" WHERE id=${parentId} UNION SELECT c.id,c."parentId" FROM "Category" c JOIN ancestry a ON c.id=a."parentId") SELECT EXISTS(SELECT 1 FROM ancestry WHERE id=${id}) AS found`;
  if (cycle.found || parentId === id) throw new TaxonomyError("A category cannot be placed inside its own descendants.", "TAXONOMY_CYCLE", 400);
}
async function detach(tx: Prisma.TransactionClient, image: string | null) {
  if (!image) return;
  try { const owner = imageKeyOwner(new URL(image).pathname.slice(1)); if (owner) await enqueueDetachedImages(tx, owner, [image], []); }
  catch (error) { if (error instanceof TypeError) return; throw error; }
}
export async function mutateTaxonomy(actor: AuthenticatedUser, raw: unknown): Promise<Result> {
  const input = taxonomyMutationSchema.parse(raw), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let verified: Awaited<ReturnType<ReturnType<typeof productMediaStore>["verify"]>> | null = null;
  if (input.action === "image" && input.uploadKey) {
    if (imageKeyOwner(input.uploadKey) !== actor.id) throw new TaxonomyError("Upload this image through your administrator account.", "TAXONOMY_IMAGE_OWNER", 400);
    const prior = await transaction(async (tx) => { await authority(tx, actor); const result = await recorded(tx, actor, input, hash); if (!result) await lockRecord(tx, input.kind, input.id, input.version); return result; });
    if (prior) return prior;
    verified = await productMediaStore().verify([input.uploadKey], actor.id);
  }
  return transaction(async (tx) => {
    await authority(tx, actor, true); const prior = await recorded(tx, actor, input, hash); if (prior) return prior;
    let result: Result;
    if (input.action === "create") {
      const id = randomUUID(); if (input.kind === "category") await parent(tx, input.fields.parentId, id);
      const row = input.kind === "category" ? await tx.category.create({ data: { id, ...input.fields } }) : await tx.brand.create({ data: { id, name: input.fields.name, slug: input.fields.slug } });
      result = { kind: input.kind, id: row.id, version: row.version, deleted: false };
    } else {
      const saved = await lockRecord(tx, input.kind, input.id, input.version), image = "image" in saved ? saved.image : saved.logo;
      if (input.action === "delete") {
        const products = await tx.product.count({ where: input.kind === "category" ? { categoryId: saved.id } : { brandId: saved.id } });
        const children = input.kind === "category" ? await tx.category.count({ where: { parentId: saved.id } }) : 0;
        if (products || children) throw new TaxonomyError("Move or retain the linked products/subcategories before deletion. Referenced catalog records cannot be deleted.", "TAXONOMY_IN_USE");
        await detach(tx, image);
        if (input.kind === "category") await tx.category.delete({ where: { id: saved.id } }); else await tx.brand.delete({ where: { id: saved.id } });
        result = { kind: input.kind, id: saved.id, version: saved.version, deleted: true };
      } else {
        let row;
        if (input.action === "image") {
          const next = input.uploadKey ? (await productMediaStore().assertPresent(verified!, actor.id))[0] : null;
          row = input.kind === "category" ? await tx.category.update({ where: { id: saved.id }, data: { image: next, version: { increment: 1 } } }) : await tx.brand.update({ where: { id: saved.id }, data: { logo: next, version: { increment: 1 } } });
          if (image !== next) await detach(tx, image);
        } else {
          if (input.kind === "category") await parent(tx, input.fields.parentId, saved.id);
          row = input.kind === "category" ? await tx.category.update({ where: { id: saved.id }, data: { ...input.fields, version: { increment: 1 } } }) : await tx.brand.update({ where: { id: saved.id }, data: { name: input.fields.name, slug: input.fields.slug, version: { increment: 1 } } });
        }
        result = { kind: input.kind, id: row.id, version: row.version, deleted: false };
      }
    }
    await tx.taxonomyRequest.create({ data: { id: input.requestId, ownerId: actor.id, hash, result } }); return result;
  }, true);
}

const categoryTree = Prisma.sql`WITH RECURSIVE tree AS (
  SELECT c.id,c."parentId",ARRAY[c.name]::text[] AS path,ARRAY[c.id]::text[] AS ancestors FROM "Category" c WHERE c."parentId" IS NULL
  UNION ALL SELECT c.id,c."parentId",t.path||c.name,t.ancestors||c.id FROM "Category" c JOIN tree t ON c."parentId"=t.id
)`;
export async function readTaxonomy(actor: AuthenticatedUser, raw: unknown) {
  const input = taxonomyQuerySchema.parse(raw), limit = 20, pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
  return transaction(async (tx) => {
    await authority(tx, actor);
    const attempt = input.requestId ? await tx.taxonomyRequest.findFirst({ where: { id: input.requestId, ownerId: actor.id, result: { path: ["kind"], equals: input.kind } }, select: { result: true } }) : null;
    if (input.mode === "history") {
      const where = { kind: input.kind, targetId: input.id! }, total = await tx.taxonomyEvent.count({ where }), pages = Math.max(1, Math.ceil(total / limit));
      if (input.page > pages) throw new TaxonomyError("This history page does not exist.", "TAXONOMY_PAGE", 404);
      const rows = await tx.taxonomyEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: (input.page - 1) * limit });
      return { ownerId: actor.id, kind: input.kind, mode: input.mode, page: input.page, total, totalPages: pages, rows: [], events: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), attempt: attempt?.result ?? null };
    }
    let total: number, rows: Row[];
    if (input.kind === "category") {
      const where = input.mode === "record" ? Prisma.sql`WHERE c.id=${input.id!}` : Prisma.sql`WHERE (c.name ILIKE ${pattern} OR c.slug ILIKE ${pattern} OR array_to_string(t.path,' / ') ILIKE ${pattern}) ${input.mode === "parents" && input.id ? Prisma.sql`AND NOT (${input.id}=ANY(t.ancestors))` : Prisma.empty}`;
      const [value] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`${categoryTree} SELECT count(*)::bigint AS total FROM "Category" c JOIN tree t ON t.id=c.id ${where}`); total = count(value.total);
      rows = await tx.$queryRaw<Row[]>(Prisma.sql`${categoryTree} SELECT c.id,c.name,c.slug,c.image,c.version,c."parentId",p.name AS "parentName",t.path,(SELECT count(*) FROM "Product" WHERE "categoryId"=c.id) AS "productsCount",(SELECT count(*) FROM "Category" WHERE "parentId"=c.id) AS "childrenCount" FROM "Category" c JOIN tree t ON t.id=c.id LEFT JOIN "Category" p ON p.id=c."parentId" ${where} ORDER BY t.path,c.id LIMIT ${limit} OFFSET ${(input.page - 1) * limit}`);
    } else {
      const where = input.mode === "record" ? Prisma.sql`WHERE b.id=${input.id!}` : Prisma.sql`WHERE b.name ILIKE ${pattern} OR b.slug ILIKE ${pattern}`;
      const [value] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS total FROM "Brand" b ${where}`); total = count(value.total);
      rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT b.id,b.name,b.slug,b.logo AS image,b.version,NULL::text AS "parentId",NULL::text AS "parentName",ARRAY[b.name]::text[] AS path,(SELECT count(*) FROM "Product" WHERE "brandId"=b.id) AS "productsCount",0::bigint AS "childrenCount" FROM "Brand" b ${where} ORDER BY b.name,b.id LIMIT ${limit} OFFSET ${(input.page - 1) * limit}`);
    }
    const pages = Math.max(1, Math.ceil(total / limit)); if (input.page > pages) throw new TaxonomyError("This catalog page does not exist.", "TAXONOMY_PAGE", 404);
    return { ownerId: actor.id, kind: input.kind, mode: input.mode, page: input.page, total, totalPages: pages, rows: rows.map((row) => ({ ...row, productsCount: count(row.productsCount), childrenCount: count(row.childrenCount) })), events: [], attempt: attempt?.result ?? null };
  });
}
export type TaxonomyView = Awaited<ReturnType<typeof readTaxonomy>>;
