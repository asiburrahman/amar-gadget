import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { inboxAudiences, NotificationError } from "@/lib/notification-policy";
import { notificationQuerySchema, notificationMutationSchema, notificationQueueQuerySchema, notificationRetrySchema, NOTIFICATION_QUEUE_STATES } from "@/lib/validations/notification";
async function inboxTransaction<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient, audiences: string[]) => Promise<T>, write = false, administrator = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    // SHARE protects current authority and remains compatible with worker fanout.
    // A retry never holds the account in UPDATE mode while waiting for its event.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
    if (!current?.isVerified || current.role !== actor.role || current.sessionVersion !== actor.sessionVersion || (administrator && current.role !== "ADMIN")) throw new NotificationError("Inbox account access changed. Sign in again.", "NOTIFICATION_ACCOUNT_CHANGED", 403);
    return work(tx, inboxAudiences(current.role));
  }, { isolationLevel: write ? "ReadCommitted" : "RepeatableRead", timeout: 10_000, maxWait: 5000 });
}
function pageInfo(total: number, page: number) {
  if (!Number.isSafeInteger(total) || total < 0) throw new NotificationError("Inbox count could not be confirmed.", "NOTIFICATION_UNAVAILABLE", 503);
  const totalPages = Math.max(1, Math.ceil(total / 20)); if (page > totalPages) throw new NotificationError("This inbox page does not exist.", "NOTIFICATION_PAGE", 404); return { total, page, totalPages };
}
export async function readNotifications(actor: AuthenticatedUser, raw: unknown) {
  const query = notificationQuerySchema.parse(raw);
  return inboxTransaction(actor, async (tx, audiences) => {
    const owned = { userId: actor.id, audience: { in: audiences } }, where = { ...owned, ...(query.kind !== "ALL" ? { kind: query.kind } : {}), ...(query.filter === "UNREAD" ? { readAt: null } : query.filter === "READ" ? { readAt: { not: null } } : {}) };
    const [total, totalNotifications, unread] = await Promise.all([tx.notification.count({ where }), tx.notification.count({ where: owned }), tx.notification.count({ where: { ...owned, readAt: null } })]);
    const pagination = pageInfo(total, query.page);
    const rows = await tx.notification.findMany({ where, take: 20, skip: (query.page - 1) * 20, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], select: { id: true, audience: true, kind: true, title: true, body: true, href: true, occurredAt: true, deliveredAt: true, readAt: true, readVersion: true } });
    return { ownerId: actor.id, ownerRole: actor.role, ...pagination, filter: query.filter, kind: query.kind, totalNotifications, unread, rows: rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString(), deliveredAt: row.deliveredAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })) };
  });
}
export async function mutateNotifications(actor: AuthenticatedUser, raw: unknown) {
  const input = notificationMutationSchema.parse(raw), entries = input.action === "read-page" ? input.entries : [{ id: input.id, version: input.version }], desiredRead = input.action !== "unread";
  return inboxTransaction(actor, async (tx, audiences) => {
    const ids = entries.map((entry) => entry.id);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Notification" WHERE "userId"=${actor.id} AND audience IN (${Prisma.join(audiences)}) AND id IN (${Prisma.join(ids)}) ORDER BY id COLLATE "C" FOR UPDATE`);
    const rows = await tx.notification.findMany({ where: { id: { in: ids }, userId: actor.id, audience: { in: audiences } }, select: { id: true, readAt: true, readVersion: true } });
    if (rows.length !== entries.length) throw new NotificationError("A selected notification is unavailable in your current inbox.", "NOTIFICATION_NOT_FOUND", 404);
    for (const row of rows) if ((row.readAt !== null) !== desiredRead && row.readVersion !== entries.find((entry) => entry.id === row.id)!.version) throw new NotificationError("A notification's read state changed. Reload before changing it again.", "NOTIFICATION_CHANGED");
    let changed = 0;
    for (const row of rows) if ((row.readAt !== null) !== desiredRead) { await tx.notification.update({ where: { id: row.id }, data: { readAt: desiredRead ? new Date() : null, readVersion: row.readVersion + 1 } }); changed++; }
    return { ownerId: actor.id, desiredRead, changed };
  }, true);
}
export async function readNotificationQueue(actor: AuthenticatedUser, raw: unknown) {
  const query = notificationQueueQuerySchema.parse(raw);
  return inboxTransaction(actor, async (tx) => {
    const where: Prisma.NotificationEventWhereInput = query.state === "ALL" ? {} : query.state === "PROBLEMS" ? { OR: [{ state: { in: ["RETRY", "DEAD"] } }, { state: "SKIPPED", lastErrorCode: "NO_RECIPIENTS" }] } : { state: query.state };
    const pagination = pageInfo(await tx.notificationEvent.count({ where }), query.page);
    const counts = await tx.notificationEvent.groupBy({ by: ["state"], _count: { _all: true } });
    const rows = await tx.notificationEvent.findMany({ where, take: 20, skip: (query.page - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, kind: true, audience: true, recipientGroup: true, recipientId: true, subjectType: true, subjectId: true, state: true, version: true, attempts: true, claimCount: true, cursorId: true, nextAttemptAt: true, leaseUntil: true, lastErrorCode: true, createdAt: true, updatedAt: true, _count: { select: { notifications: true } } } });
    return { ownerId: actor.id, ...pagination, state: query.state, counts: Object.fromEntries(NOTIFICATION_QUEUE_STATES.map((state) => [state, counts.find((row) => row.state === state)?._count._all ?? 0])), rows: rows.map(({ _count, ...row }) => ({ ...row, deliveredRecipients: _count.notifications, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), nextAttemptAt: row.nextAttemptAt.toISOString(), leaseUntil: row.leaseUntil?.toISOString() ?? null })) };
  }, false, true);
}
export async function retryNotificationEvent(actor: AuthenticatedUser, raw: unknown) {
  const input = notificationRetrySchema.parse(raw);
  return inboxTransaction(actor, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "NotificationEvent" WHERE id=${input.id} FOR UPDATE`;
    const event = await tx.notificationEvent.findUnique({ where: { id: input.id } });
    if (!event) throw new NotificationError("Notification delivery event was not found.", "NOTIFICATION_NOT_FOUND", 404);
    if (event.state === "READY" && event.version === input.version + 1) return { ownerId: actor.id, requeued: false };
    if (event.version !== input.version || !(event.state === "RETRY" || event.state === "DEAD" || (event.state === "SKIPPED" && event.lastErrorCode === "NO_RECIPIENTS"))) throw new NotificationError("This delivery event changed or is not eligible for retry. Reload its current state.", "NOTIFICATION_CHANGED");
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT timezone('UTC',clock_timestamp()) AS now`;
    await tx.notificationRetryEvent.create({ data: { eventId: event.id, actorId: actor.id, reason: input.reason } });
    await tx.notificationEvent.update({ where: { id: event.id }, data: { state: "READY", version: event.version + 1, attempts: 0, nextAttemptAt: clock.now, leaseToken: null, leaseUntil: null, lastErrorCode: null } });
    return { ownerId: actor.id, requeued: true };
  }, true, true);
}
export type NotificationInbox = Awaited<ReturnType<typeof readNotifications>>;
export type NotificationQueue = Awaited<ReturnType<typeof readNotificationQueue>>;
