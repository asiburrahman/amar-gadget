import { randomUUID } from "node:crypto";
import { Prisma, type NotificationEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notificationMessage, NotificationDeliveryError } from "@/lib/notification-policy";
const PAGE_SIZE = 100, MAX_ATTEMPTS = 8;
// The installed pg adapter maps raw timestamptz through the host timezone.
// Match the schema's UTC timestamp columns explicitly before Date arithmetic.
async function clock(tx: Prisma.TransactionClient) { const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT timezone('UTC',clock_timestamp()) AS now`; return row.now; }
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`; return work(tx); }, { timeout: 10_000, maxWait: 5000 });
}
export async function claimNotificationEvent() {
  return transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "NotificationEvent" WHERE
       (state IN ('READY','RETRY') AND "nextAttemptAt"<=timezone('UTC',clock_timestamp()))
       OR (state='PROCESSING' AND "leaseUntil"<=timezone('UTC',clock_timestamp()))
      ORDER BY "nextAttemptAt",id COLLATE "C" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidate) return null;
    const row = await tx.notificationEvent.findUniqueOrThrow({ where: { id: candidate.id } }), now = await clock(tx);
    if (row.attempts >= MAX_ATTEMPTS) {
      await tx.notificationEvent.update({ where: { id: row.id }, data: { state: "DEAD", version: row.version + 1, leaseToken: null, leaseUntil: null, lastErrorCode: "ATTEMPT_LIMIT" } }); return { id: row.id, leaseToken: null };
    }
    const leaseToken = randomUUID();
    await tx.notificationEvent.update({ where: { id: row.id }, data: { state: "PROCESSING", version: row.version + 1, attempts: row.attempts + 1, claimCount: row.claimCount + 1, leaseToken, leaseUntil: new Date(now.getTime() + 30_000), lastErrorCode: null } });
    return { id: row.id, leaseToken };
  });
}
async function sourceExists(tx: Prisma.TransactionClient, event: NotificationEvent) {
  const where = { id: event.subjectId }, select = { id: true };
  switch (event.subjectType) {
    case "ACCOUNT": return !!await tx.user.findUnique({ where, select });
    case "PRODUCT": return !!await tx.product.findUnique({ where, select });
    case "ORDER": return !!await tx.order.findUnique({ where, select });
    case "FULFILLMENT": return !!await tx.orderFulfillment.findUnique({ where, select });
    case "PAYOUT": return !!await tx.sellerPayout.findUnique({ where, select });
    case "POLICY": return !!await tx.sellerSettlementPolicy.findUnique({ where, select });
    default: throw new NotificationDeliveryError("INVALID_NOTIFICATION_EVENT");
  }
}
export async function deliverNotificationClaim(id: string, leaseToken: string) {
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "NotificationEvent" WHERE id=${id} FOR UPDATE`;
    const event = await tx.notificationEvent.findUniqueOrThrow({ where: { id } }), now = await clock(tx);
    if (event.state !== "PROCESSING" || event.leaseToken !== leaseToken || !event.leaseUntil || event.leaseUntil <= now) throw new NotificationDeliveryError("STALE_NOTIFICATION_LEASE");
    const rendered = notificationMessage(event);
    const reference = ["ORDER", "PRODUCT", "FULFILLMENT", "PAYOUT"].includes(event.subjectType) && /^[A-Za-z0-9-]{1,64}$/.test(event.subjectId) ? ` Reference: ${event.subjectId}.` : "";
    // Use the captured entity reference, never a later foreign owner's product
    // fields, customer address or an external payment reference as context.
    const message = { ...rendered, body: rendered.body + reference };
    const finish = (state: string, lastErrorCode: string | null) => tx.notificationEvent.update({ where: { id }, data: { state, version: event.version + 1, leaseToken: null, leaseUntil: null, lastErrorCode } });
    if (!await sourceExists(tx, event)) { await finish("SKIPPED", "SOURCE_REMOVED"); return { state: "SKIPPED", inserted: 0 }; }
    let condition: Prisma.Sql;
    if (event.recipientGroup === "DIRECT") condition = Prisma.sql`u.id=${event.recipientId}`;
    else if (event.recipientGroup === "ADMINS") condition = Prisma.sql`u.role='ADMIN' AND u."isVerified"`;
    else if (event.recipientGroup === "ORDER_SELLERS") condition = Prisma.sql`EXISTS(SELECT 1 FROM "OrderFulfillment" f WHERE f."orderId"=${event.subjectId} AND f."sellerId"=u.id)`;
    else if (event.recipientGroup === "SELLERS") condition = Prisma.sql`u."isVerified" AND (u.role='MEMBER' OR (u.role='ADMIN' AND EXISTS(SELECT 1 FROM "Product" WHERE "sellerId"=u.id)))`;
    else throw new NotificationDeliveryError("INVALID_NOTIFICATION_EVENT");
    const recipients = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT u.id FROM "User" u WHERE ${condition} AND u.id COLLATE "C">${event.cursorId ?? ""} COLLATE "C" ORDER BY u.id COLLATE "C" LIMIT ${PAGE_SIZE} FOR SHARE OF u`);
    if (!recipients.length) {
      const state = event.cursorId ? "DELIVERED" : "SKIPPED"; await finish(state, event.cursorId ? null : "NO_RECIPIENTS"); return { state, inserted: 0 };
    }
    const saved = await tx.notification.createMany({ data: recipients.map((recipient) => ({ id: randomUUID(), eventId: id, userId: recipient.id, audience: event.audience, kind: event.kind, ...message, occurredAt: event.createdAt })), skipDuplicates: true });
    const complete = recipients.length < PAGE_SIZE;
    await tx.notificationEvent.update({ where: { id }, data: { state: complete ? "DELIVERED" : "READY", version: event.version + 1, cursorId: recipients.at(-1)!.id, attempts: complete ? event.attempts : 0, nextAttemptAt: new Date(now.getTime() + 10), leaseToken: null, leaseUntil: null, lastErrorCode: null } });
    return { state: complete ? "DELIVERED" : "READY", inserted: saved.count };
  });
}
async function failClaim(id: string, leaseToken: string, error: unknown) {
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "NotificationEvent" WHERE id=${id} FOR UPDATE`;
    const event = await tx.notificationEvent.findUnique({ where: { id } });
    if (!event || event.state !== "PROCESSING" || event.leaseToken !== leaseToken) return "STALE";
    const permanent = error instanceof NotificationDeliveryError && error.code === "INVALID_NOTIFICATION_EVENT", now = await clock(tx);
    const state = permanent || event.attempts >= MAX_ATTEMPTS ? "DEAD" : "RETRY";
    await tx.notificationEvent.update({ where: { id }, data: { state, version: event.version + 1, nextAttemptAt: new Date(now.getTime() + Math.min(300, 2 ** (event.attempts - 1)) * 1000), leaseToken: null, leaseUntil: null, lastErrorCode: permanent ? "INVALID_NOTIFICATION_EVENT" : "DELIVERY_UNCONFIRMED" } }); return state;
  });
}
export async function sweepNotificationEvents(requestedLimit = 10) {
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) throw new Error("Notification delivery limit must be 1 through 20.");
  const summary = { checked: 0, delivered: 0, progressed: 0, inserted: 0, skipped: 0, deferred: 0, dead: 0 }, deadline = Date.now() + 20_000;
  while (summary.checked < requestedLimit && Date.now() < deadline) {
    const claim = await claimNotificationEvent(); if (!claim) break; summary.checked++;
    if (!claim.leaseToken) { summary.dead++; continue; }
    try { const result = await deliverNotificationClaim(claim.id, claim.leaseToken); summary.inserted += result.inserted; if (result.state === "DELIVERED") summary.delivered++; else if (result.state === "SKIPPED") summary.skipped++; else summary.progressed++; }
    catch (error) { const state = await failClaim(claim.id, claim.leaseToken, error); if (state === "DEAD") summary.dead++; else summary.deferred++; }
  }
  return summary;
}
