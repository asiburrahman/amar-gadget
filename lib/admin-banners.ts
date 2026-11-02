import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Banner } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { bannerMutationSchema, bannerQuerySchema, isBannerLink, type BannerMutation } from "@/lib/validations/banner";
import { isPublicProductImageUrl } from "@/lib/product-media-policy";
import { productMediaStore } from "@/lib/cloudflare/r2";
import { imageKeyOwner } from "@/lib/product-image-keys";
import { enqueueDetachedImages } from "@/lib/product-image-lifecycle";
import { MAX_ACTIVE_BANNERS_PER_PLACEMENT } from "@/lib/homepage-banners";
export class BannerError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
type Result = { id: string; version: number; deleted: boolean };
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, write = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    if (write) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('amar.banner-admin.v1',0))`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 5000, isolationLevel: write ? "ReadCommitted" : "RepeatableRead" });
}
async function authority(tx: Prisma.TransactionClient, actor: AuthenticatedUser, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`; else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
  if (actor.role !== "ADMIN" || current?.role !== "ADMIN" || !current.isVerified || current.sessionVersion !== actor.sessionVersion) throw new BannerError("Your administrator account changed. Reload your session.", "BANNER_ACCOUNT_CHANGED", 403);
  await tx.$queryRaw`SELECT set_config('amar.banner_actor_id',${actor.id},true)`;
}
const dto = (row: Banner) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
async function lockRecord(tx: Prisma.TransactionClient, id: string, version: number) {
  await tx.$queryRaw`SELECT id FROM "Banner" WHERE id=${id} FOR UPDATE`;
  const row = await tx.banner.findUnique({ where: { id } });
  if (!row) throw new BannerError("This banner no longer exists. Reload saved state.", "BANNER_NOT_FOUND", 404);
  if (row.version !== version) throw new BannerError("This banner changed. Reload its revision before editing.", "BANNER_CHANGED");
  return row;
}
async function recorded(tx: Prisma.TransactionClient, actor: AuthenticatedUser, input: BannerMutation, hash: string) {
  const prior = await tx.bannerRequest.findUnique({ where: { id: input.requestId } });
  if (!prior) return null;
  if (prior.ownerId !== actor.id || prior.hash !== hash) throw new BannerError("This request identity belongs to different changes.", "BANNER_REQUEST_CONFLICT");
  return prior.result as unknown as Result;
}
async function answer(tx: Prisma.TransactionClient, result: Result) {
  const row = await tx.banner.findUnique({ where: { id: result.id } }); return { result, row: row ? dto(row) : null, currentDeleted: row === null };
}
async function capacity(tx: Prisma.TransactionClient, row: { placement: string; isActive: boolean }, id?: string) {
  if (row.isActive && await tx.banner.count({ where: { placement: row.placement, isActive: true, ...(id ? { id: { not: id } } : {}) } }) >= MAX_ACTIVE_BANNERS_PER_PLACEMENT) throw new BannerError(`Each placement supports ${MAX_ACTIVE_BANNERS_PER_PLACEMENT} active banners. Deactivate one first.`, "BANNER_CAPACITY");
}
function publishable(row: { isActive: boolean; imageUrl: string; linkUrl: string | null }) {
  if (row.isActive && (!isPublicProductImageUrl(row.imageUrl) || (row.linkUrl !== null && !isBannerLink(row.linkUrl)))) throw new BannerError("Correct this banner's saved image and storefront link before activating it.", "BANNER_PUBLICATION", 400);
}
async function detach(tx: Prisma.TransactionClient, image: string) {
  try { const owner = imageKeyOwner(new URL(image).pathname.slice(1)); if (owner) await enqueueDetachedImages(tx, owner, [image], []); }
  catch (error) { if (error instanceof TypeError) return; throw error; }
}
export async function mutateBanner(actor: AuthenticatedUser, raw: unknown) {
  const input = bannerMutationSchema.parse(raw), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let verified: Awaited<ReturnType<ReturnType<typeof productMediaStore>["verify"]>> | null = null;
  if (input.action === "create" || input.action === "image") {
    if (imageKeyOwner(input.uploadKey) !== actor.id) throw new BannerError("Upload this image through your administrator account.", "BANNER_IMAGE_OWNER", 400);
    const prior = await transaction(async (tx) => { await authority(tx, actor); const receipt = await recorded(tx, actor, input, hash); if (receipt) return answer(tx, receipt); if (input.action === "image") await lockRecord(tx, input.id, input.version); return null; });
    if (prior) return prior;
    verified = await productMediaStore().verify([input.uploadKey], actor.id);
  }
  return transaction(async (tx) => {
    await authority(tx, actor, true); const prior = await recorded(tx, actor, input, hash); if (prior) return answer(tx, prior);
    let result: Result;
    if (input.action === "create") {
      await capacity(tx, input.fields);
      const imageUrl = (await productMediaStore().assertPresent(verified!, actor.id))[0];
      const row = await tx.banner.create({ data: { id: randomUUID(), ...input.fields, imageUrl } }); result = { id: row.id, version: row.version, deleted: false };
    } else {
      const current = await lockRecord(tx, input.id, input.version);
      if (input.action === "delete") {
        await detach(tx, current.imageUrl); await tx.banner.delete({ where: { id: current.id } }); result = { id: current.id, version: current.version, deleted: true };
      } else {
        let data: Prisma.BannerUpdateInput;
        if (input.action === "image") { const imageUrl = (await productMediaStore().assertPresent(verified!, actor.id))[0]; publishable({ ...current, imageUrl }); data = { imageUrl }; if (imageUrl !== current.imageUrl) await detach(tx, current.imageUrl); }
        else if (input.action === "activation") { publishable({ ...current, isActive: input.isActive }); await capacity(tx, { placement: current.placement, isActive: input.isActive }, current.id); data = { isActive: input.isActive }; }
        else { publishable({ ...current, ...input.fields }); await capacity(tx, input.fields, current.id); data = input.fields; }
        const row = await tx.banner.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } }); result = { id: row.id, version: row.version, deleted: false };
      }
    }
    await tx.bannerRequest.create({ data: { id: input.requestId, ownerId: actor.id, hash, result } }); return answer(tx, result);
  }, true);
}
export async function readBanners(actor: AuthenticatedUser, raw: unknown) {
  const input = bannerQuerySchema.parse(raw), limit = 20;
  return transaction(async (tx) => {
    await authority(tx, actor);
    const receipt = input.requestId ? await tx.bannerRequest.findFirst({ where: { id: input.requestId, ownerId: actor.id } }) : null;
    const attempt = receipt ? receipt.result as unknown as Result : null, attemptedRow = attempt ? (await answer(tx, attempt)).row : null;
    if (input.mode === "history") {
      const where = { bannerId: input.id! }, total = await tx.bannerEvent.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
      if (input.page > totalPages) throw new BannerError("This history page does not exist.", "BANNER_PAGE", 404);
      const events = await tx.bannerEvent.findMany({ where, orderBy: { sequence: "desc" }, take: limit, skip: (input.page - 1) * limit });
      return { ownerId: actor.id, rows: [], events: events.map((row) => ({ ...row, sequence: row.sequence.toString(), createdAt: row.createdAt.toISOString() })), total, totalPages, page: input.page, attempt, attemptedRow, attemptedDeleted: attempt ? attemptedRow === null : null };
    }
    const where: Prisma.BannerWhereInput = input.mode === "record" ? { id: input.id } : { title: { contains: input.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" }, ...(input.placement !== "ALL" ? { placement: input.placement } : {}), ...(input.status !== "ALL" ? { isActive: input.status === "ACTIVE" } : {}) };
    const total = await tx.banner.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
    if (input.page > totalPages) throw new BannerError("This banner page does not exist.", "BANNER_PAGE", 404);
    if (input.mode === "record" && !total) throw new BannerError("This banner no longer exists.", "BANNER_NOT_FOUND", 404);
    const rows = await tx.banner.findMany({ where, orderBy: [{ placement: "asc" }, { position: "asc" }, { id: "asc" }], take: limit, skip: (input.page - 1) * limit });
    return { ownerId: actor.id, rows: rows.map(dto), events: [], total, totalPages, page: input.page, attempt, attemptedRow, attemptedDeleted: attempt ? attemptedRow === null : null };
  });
}
export type BannerView = Awaited<ReturnType<typeof readBanners>>;
export type BannerRow = ReturnType<typeof dto>;
