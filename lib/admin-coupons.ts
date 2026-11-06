import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Coupon } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { checkoutTotals } from "@/lib/coupon-policy";
import { couponActionSchema, couponQuerySchema } from "@/lib/validations/coupon";

export class CouponError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, write = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    if (write) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('amar.coupon-admin.v1',0))`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 5000, isolationLevel: write ? "ReadCommitted" : "RepeatableRead" });
}
async function authority(tx: Prisma.TransactionClient, actor: AuthenticatedUser, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
  if (actor.role !== "ADMIN" || current?.role !== "ADMIN" || !current.isVerified || current.sessionVersion !== actor.sessionVersion) throw new CouponError("Your administrator account changed. Reload your session.", "COUPON_ACCOUNT_CHANGED", 403);
  await tx.$queryRaw`SELECT set_config('amar.coupon_actor_id',${actor.id},true)`;
}
async function record(tx: Prisma.TransactionClient, id: string, version?: number, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id=${id} FOR UPDATE`;
  const row = await tx.coupon.findUnique({ where: { id } });
  if (!row) throw new CouponError("This coupon no longer exists.", "COUPON_NOT_FOUND", 404);
  if (version !== undefined && row.version !== version) throw new CouponError("This coupon changed. Reload its current revision before editing.", "COUPON_CHANGED");
  return row;
}
async function usage(tx: Prisma.TransactionClient, code: string) {
  const [row] = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM "Order" WHERE upper(btrim("couponCode"))=${code}`;
  const total = Number(row.total);
  if (!Number.isSafeInteger(total)) throw new Error("Coupon usage exceeds the supported range");
  return total;
}
async function dto(tx: Prisma.TransactionClient, row: Coupon, now: Date) {
  return { ...row, discount: Number(row.discount), minSpend: row.minSpend === null ? null : Number(row.minSpend), expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), usedOrders: await usage(tx, row.code),
    status: !row.isActive ? "INACTIVE" : row.expiresAt && row.expiresAt <= now ? "EXPIRED" : "ACTIVE" };
}
export async function mutateCoupon(actor: AuthenticatedUser, raw: unknown) {
  const input = couponActionSchema.parse(raw);
  if (input.action === "preview") return transaction(async (tx) => {
    await authority(tx, actor);
    if (input.target) await record(tx, input.target.id, input.target.version);
    const now = new Date(), fields = input.fields;
    const totals = checkoutTotals(new Prisma.Decimal(input.subtotal), input.paymentMethod, { ...fields, discount: new Prisma.Decimal(fields.discount), minSpend: fields.minSpend === null ? null : new Prisma.Decimal(fields.minSpend), expiresAt: fields.expiresAt ? new Date(fields.expiresAt) : null }, true, now);
    return { kind: "preview" as const, totals, evaluatedAt: now.toISOString() };
  });
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return transaction(async (tx) => {
    await authority(tx, actor, true);
    const prior = await tx.couponRequest.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.ownerId !== actor.id || prior.hash !== hash) throw new CouponError("This request identity belongs to different changes.", "COUPON_REQUEST_CONFLICT");
      const result = prior.result as { id: string; version: number };
      return { kind: "saved" as const, result, row: await dto(tx, await record(tx, result.id), new Date()) };
    }
    let saved: Coupon;
    if (input.action === "create") saved = await tx.coupon.create({ data: { id: randomUUID(), ...input.fields } });
    else {
      const current = await record(tx, input.id, input.version, true);
      if (input.action === "update" && input.fields.code !== current.code && await usage(tx, current.code)) throw new CouponError("This code belongs to saved orders. Retain it and create a separate coupon for the new code.", "COUPON_CODE_IN_USE");
      const data = input.action === "activation" ? { isActive: input.isActive } : input.fields;
      saved = await tx.coupon.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } });
    }
    const result = { id: saved.id, version: saved.version };
    await tx.couponRequest.create({ data: { id: input.requestId, ownerId: actor.id, hash, result } });
    return { kind: "saved" as const, result, row: await dto(tx, saved, new Date()) };
  }, true);
}
export async function readCoupons(actor: AuthenticatedUser, raw: unknown) {
  const input = couponQuerySchema.parse(raw), limit = 20;
  return transaction(async (tx) => {
    await authority(tx, actor);
    const now = new Date();
    const receipt = input.requestId ? await tx.couponRequest.findFirst({ where: { id: input.requestId, ownerId: actor.id } }) : null;
    const attempt = receipt ? receipt.result as { id: string; version: number } : null;
    const attemptedRow = attempt ? await dto(tx, await record(tx, attempt.id), now) : null;
    if (input.mode === "history") {
      await record(tx, input.id!);
      const where = { couponId: input.id! }, total = await tx.couponEvent.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
      if (input.page > totalPages) throw new CouponError("This history page does not exist.", "COUPON_PAGE", 404);
      const events = await tx.couponEvent.findMany({ where, orderBy: { sequence: "desc" }, skip: (input.page - 1) * limit, take: limit });
      return { ownerId: actor.id, rows: [], events: events.map((row) => ({ ...row, sequence: row.sequence.toString(), createdAt: row.createdAt.toISOString() })), total, totalPages, page: input.page, attempt, attemptedRow };
    }
    const where: Prisma.CouponWhereInput = input.mode === "record" ? { id: input.id } : {
      code: { contains: input.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" },
      ...(input.status === "INACTIVE" ? { isActive: false } : input.status === "EXPIRED" ? { isActive: true, expiresAt: { lte: now } } : input.status === "ACTIVE" ? { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : {}),
    };
    const total = await tx.coupon.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
    if (input.page > totalPages) throw new CouponError("This coupon page does not exist.", "COUPON_PAGE", 404);
    if (input.mode === "record" && !total) throw new CouponError("This coupon no longer exists.", "COUPON_NOT_FOUND", 404);
    const rows = await tx.coupon.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * limit, take: limit });
    return { ownerId: actor.id, rows: await Promise.all(rows.map((row) => dto(tx, row, now))), events: [], total, totalPages, page: input.page, attempt, attemptedRow };
  });
}
export type CouponView = Awaited<ReturnType<typeof readCoupons>>;
export type CouponRow = Awaited<ReturnType<typeof dto>>;
