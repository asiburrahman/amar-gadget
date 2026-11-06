import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { SupportError, supportDecisionHash, supportSubmissionHash } from "@/lib/support-policy";
import { supportQueueQuerySchema, supportStatusMutationSchema, supportSubmissionSchema } from "@/lib/validations/support";

async function bounds(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`;
  await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
}
export async function supportAdministrator<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient) => Promise<T>, write = false) {
  return prisma.$transaction(async (tx) => {
    await bounds(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
    if (!current?.isVerified || current.role !== "ADMIN" || actor.role !== "ADMIN" || current.sessionVersion !== actor.sessionVersion) throw new SupportError("Administrator access changed. Sign in again.", 403, "SUPPORT_FORBIDDEN");
    return work(tx);
  }, { isolationLevel: write ? "ReadCommitted" : "RepeatableRead", maxWait: 5000, timeout: 10_000 });
}

export async function submitSupportMessage(raw: unknown) {
  const input = supportSubmissionSchema.parse(raw), hash = supportSubmissionHash(input);
  return prisma.$transaction(async (tx) => {
    await bounds(tx);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`support:submit:${input.requestId}`},0))`;
    const prior = await tx.supportMessage.findUnique({ where: { id: input.requestId }, select: { id: true, contentHash: true, createdAt: true } });
    if (prior) {
      if (prior.contentHash !== hash) throw new SupportError("This submission reference belongs to different content. Keep the original message for an exact retry.");
      return { id: prior.id, receivedAt: prior.createdAt.toISOString() };
    }
    const saved = await tx.supportMessage.create({ data: {
      id: input.requestId, contentHash: hash, name: input.name, email: input.email,
      topic: input.topic, subject: input.subject, orderReference: input.orderReference ?? null, message: input.message,
    }, select: { id: true, createdAt: true } });
    return { id: saved.id, receivedAt: saved.createdAt.toISOString() };
  }, { maxWait: 5000, timeout: 10_000 });
}

export async function readSupportQueue(actor: AuthenticatedUser, raw: unknown) {
  const query = supportQueueQuerySchema.parse(raw);
  return supportAdministrator(actor, async (tx) => {
    const where = { ...(query.status === "ALL" ? {} : { status: query.status }), ...(query.topic === "ALL" ? {} : { topic: query.topic }) };
    const [total, grouped] = await Promise.all([tx.supportMessage.count({ where }), tx.supportMessage.groupBy({ by: ["status"], _count: { _all: true } })]);
    const totalPages = Math.max(1, Math.ceil(total / 20));
    if (query.page > totalPages) throw new SupportError("This support page does not exist.", 404, "SUPPORT_NOT_FOUND");
    const rows = await tx.supportMessage.findMany({ where, take: 20, skip: (query.page - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, topic: true, subject: true, status: true, version: true, createdAt: true, updatedAt: true } });
    return { ownerId: actor.id, ...query, total, totalPages, counts: Object.fromEntries(["OPEN", "IN_PROGRESS", "RESOLVED"].map((status) => [status, grouped.find((row) => row.status === status)?._count._all ?? 0])), rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
  });
}

export async function readSupportMessage(actor: AuthenticatedUser, id: string, eventPage = 1) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !Number.isSafeInteger(eventPage) || eventPage < 1 || eventPage > 1_000_000) throw new SupportError("Invalid support reference or history page.", 400, "SUPPORT_REQUEST");
  return supportAdministrator(actor, async (tx) => {
    const message = await tx.supportMessage.findUnique({ where: { id } });
    if (!message) throw new SupportError("Support message was not found.", 404, "SUPPORT_NOT_FOUND");
    const total = await tx.supportMessageEvent.count({ where: { messageId: id } }), totalPages = Math.max(1, Math.ceil(total / 20));
    if (eventPage > totalPages) throw new SupportError("This history page does not exist.", 404, "SUPPORT_NOT_FOUND");
    const events = await tx.supportMessageEvent.findMany({ where: { messageId: id }, take: 20, skip: (eventPage - 1) * 20, orderBy: { version: "desc" } });
    // The retry digest is private implementation state, not support content.
    const { contentHash: _contentHash, ...fields } = message;
    void _contentHash;
    return { ownerId: actor.id, message: { ...fields, consentAt: fields.consentAt.toISOString(), createdAt: fields.createdAt.toISOString(), updatedAt: fields.updatedAt.toISOString() }, history: { page: eventPage, total, totalPages, rows: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })) } };
  });
}

export async function mutateSupportStatus(actor: AuthenticatedUser, raw: unknown) {
  const input = supportStatusMutationSchema.parse(raw), hash = supportDecisionHash(input);
  return supportAdministrator(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`support:decision:${input.requestId}`},0))`;
    const prior = await tx.supportRequest.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.ownerId !== actor.id || prior.contentHash !== hash) throw new SupportError("This operation reference was already used for another decision.");
      return { ownerId: actor.id, result: prior.result };
    }
    await tx.$queryRaw`SELECT id FROM "SupportMessage" WHERE id=${input.id} FOR UPDATE`;
    const current = await tx.supportMessage.findUnique({ where: { id: input.id }, select: { status: true, version: true } });
    if (!current) throw new SupportError("Support message was not found.", 404, "SUPPORT_NOT_FOUND");
    if (current.version !== input.version) throw new SupportError("The saved status changed. Reload before making another decision.");
    if (current.status === input.status) throw new SupportError("Choose a different status; the current status is already saved.");
    await tx.supportMessageEvent.create({ data: { messageId: input.id, version: input.version + 1, actorId: actor.id, beforeStatus: current.status, afterStatus: input.status, reason: input.reason } });
    const saved = await tx.supportMessage.update({ where: { id: input.id }, data: { status: input.status, version: input.version + 1 }, select: { id: true, status: true, version: true, updatedAt: true } });
    const result = { ...saved, updatedAt: saved.updatedAt.toISOString() };
    await tx.supportRequest.create({ data: { id: input.requestId, ownerId: actor.id, contentHash: hash, result } });
    return { ownerId: actor.id, result };
  }, true);
}

export type SupportQueue = Awaited<ReturnType<typeof readSupportQueue>>;
export type SupportDetail = Awaited<ReturnType<typeof readSupportMessage>>;
