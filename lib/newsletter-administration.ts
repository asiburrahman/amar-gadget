import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { NewsletterError } from "@/lib/newsletter-policy";
import { NEWSLETTER_STATES, NEWSLETTER_DELIVERY_STATES, newsletterAdminQuerySchema } from "@/lib/validations/newsletter";
function pagination(total: number, page: number) {
  const totalPages = Math.max(1, Math.ceil(total / 20));
  if (page > totalPages) throw new NewsletterError("This newsletter page does not exist.", 404, "NEWSLETTER_NOT_FOUND");
  return { total, page, totalPages };
}
export async function readNewsletterAdministration(actor: AuthenticatedUser, raw: unknown) {
  const query = newsletterAdminQuerySchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
    if (actor.role !== "ADMIN" || current?.role !== "ADMIN" || !current.isVerified || current.sessionVersion !== actor.sessionVersion) throw new NewsletterError("Administrator access changed. Sign in again.", 403, "NEWSLETTER_FORBIDDEN");
    if (query.mode === "SUBSCRIBERS") {
      const where = query.status === "ALL" ? {} : { status: query.status };
      const total = await tx.newsletterSubscriber.count({ where }), grouped = await tx.newsletterSubscriber.groupBy({ by: ["status"], _count: { _all: true } });
      const rows = await tx.newsletterSubscriber.findMany({ where, take: 20, skip: (query.page - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, email: true, status: true, consentVersion: true, consentedAt: true, confirmedAt: true, unsubscribedAt: true, lastRequestedAt: true, createdAt: true } });
      return { mode: "SUBSCRIBERS" as const, ownerId: actor.id, status: query.status, ...pagination(total, query.page), counts: Object.fromEntries(NEWSLETTER_STATES.map((state) => [state, grouped.find((entry) => entry.status === state)?._count._all ?? 0])), rows: rows.map((row) => ({ ...row, consentedAt: row.consentedAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null, unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null, lastRequestedAt: row.lastRequestedAt.toISOString(), createdAt: row.createdAt.toISOString() })) };
    }
    const where = query.state === "ALL" ? {} : { state: query.state };
    const total = await tx.newsletterRequest.count({ where }), grouped = await tx.newsletterRequest.groupBy({ by: ["state"], _count: { _all: true } });
    const rows = await tx.newsletterRequest.findMany({ where, take: 20, skip: (query.page - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, subscriber: { select: { email: true } }, generation: true, state: true, attempts: true, nextAttemptAt: true, leaseUntil: true, lastErrorCode: true, sentAt: true, createdAt: true, updatedAt: true } });
    return { mode: "DELIVERIES" as const, ownerId: actor.id, state: query.state, ...pagination(total, query.page), counts: Object.fromEntries(NEWSLETTER_DELIVERY_STATES.map((state) => [state, grouped.find((entry) => entry.state === state)?._count._all ?? 0])), rows: rows.map(({ subscriber, ...row }) => ({ ...row, email: subscriber.email, nextAttemptAt: row.nextAttemptAt.toISOString(), leaseUntil: row.leaseUntil?.toISOString() ?? null, sentAt: row.sentAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10_000 });
}
export type NewsletterAdministration = Awaited<ReturnType<typeof readNewsletterAdministration>>;
