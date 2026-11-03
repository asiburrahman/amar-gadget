import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendNewsletterConfirmation } from "@/lib/mail/send-newsletter-confirmation";
import { MailConfigurationError } from "@/lib/mail/nodemailer";
import { RuntimeConfigurationError } from "@/config/runtime";
import { NewsletterError, NEWSLETTER_CONFIRMATION_MS, NEWSLETTER_RESEND_MS, NEWSLETTER_LEASE_MS, newsletterRequestHash, validNewsletterToken } from "@/lib/newsletter-policy";
import { NEWSLETTER_CONSENT_VERSION, newsletterSubscribeSchema, newsletterTokenMutationSchema } from "@/lib/validations/newsletter";

async function databaseNow(tx: Prisma.TransactionClient) {
  return (await tx.$queryRaw<{ now: Date }[]>`SELECT timezone('UTC',clock_timestamp()) AS now`)[0].now;
}
async function transaction<T>(work: (tx: Prisma.TransactionClient, now: Date) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    return work(tx, await databaseNow(tx));
  }, { maxWait: 5000, timeout: 10_000 });
}

export async function recordNewsletterRequest(raw: unknown) {
  const input = newsletterSubscribeSchema.parse(raw), hash = newsletterRequestHash(input);
  return transaction(async (tx, now) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`newsletter:request:${input.requestId}`},0))`;
    const prior = await tx.newsletterRequest.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.contentHash !== hash) throw new NewsletterError("This request reference was used for different details. Retry the original request unchanged.");
      return { id: prior.id };
    }
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`newsletter:email:${input.email}`},0))`;
    const existing = await tx.newsletterSubscriber.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) await tx.$queryRaw`SELECT id FROM "NewsletterSubscriber" WHERE id=${existing.id} FOR UPDATE`;
    now = await databaseNow(tx);
    let subscriber = existing ? await tx.newsletterSubscriber.findUniqueOrThrow({ where: { id: existing.id } }) : null;
    if (subscriber) {
      const wait = NEWSLETTER_RESEND_MS - (now.getTime() - subscriber.lastRequestedAt.getTime());
      if (wait > 0) throw new NewsletterError("Please wait before another newsletter request.", 429, "NEWSLETTER_RATE", Math.ceil(wait / 1000));
      const recent = await tx.newsletterRequest.count({ where: { subscriberId: subscriber.id, createdAt: { gt: new Date(now.getTime() - 10 * 60_000) } } });
      if (recent >= 3) throw new NewsletterError("Too many newsletter requests. Try again later.", 429, "NEWSLETTER_RATE", 600);
    }
    if (!subscriber) {
      subscriber = await tx.newsletterSubscriber.create({ data: { email: input.email, confirmationNonce: randomUUID(), unsubscribeNonce: randomUUID(), confirmationExpiresAt: new Date(now.getTime() + NEWSLETTER_CONFIRMATION_MS), consentVersion: NEWSLETTER_CONSENT_VERSION, consentedAt: now, lastRequestedAt: now } });
      await tx.newsletterEvent.create({ data: { subscriberId: subscriber.id, version: 1, generation: 1, kind: "REQUESTED", beforeStatus: null, afterStatus: "PENDING", sourceRequestId: input.requestId, consentVersion: NEWSLETTER_CONSENT_VERSION } });
    } else if (subscriber.status === "UNSUBSCRIBED" || (subscriber.status === "PENDING" && subscriber.confirmationExpiresAt <= now)) {
      await tx.newsletterEvent.create({ data: { subscriberId: subscriber.id, version: subscriber.version + 1, generation: subscriber.generation + 1, kind: "RENEWED", beforeStatus: subscriber.status, afterStatus: "PENDING", sourceRequestId: input.requestId, consentVersion: NEWSLETTER_CONSENT_VERSION } });
      subscriber = await tx.newsletterSubscriber.update({ where: { id: subscriber.id }, data: { status: "PENDING", version: subscriber.version + 1, generation: subscriber.generation + 1, confirmationNonce: randomUUID(), confirmationExpiresAt: new Date(now.getTime() + NEWSLETTER_CONFIRMATION_MS), consentVersion: NEWSLETTER_CONSENT_VERSION, consentedAt: now, confirmedAt: null, unsubscribedAt: null, lastRequestedAt: now } });
    } else subscriber = await tx.newsletterSubscriber.update({ where: { id: subscriber.id }, data: { lastRequestedAt: now } });
    const request = await tx.newsletterRequest.create({ data: { id: input.requestId, contentHash: hash, subscriberId: subscriber.id, generation: subscriber.generation, state: "READY", nextAttemptAt: now } });
    return { id: request.id };
  });
}

/** Claim under subscriber -> request locks, then release SQL before SMTP. */
export async function claimNewsletterDelivery(id: string) {
  return transaction(async (tx, now) => {
    const pointer = await tx.newsletterRequest.findUnique({ where: { id }, select: { subscriberId: true } });
    if (!pointer) throw new NewsletterError("This newsletter request is unavailable.", 404, "NEWSLETTER_NOT_FOUND");
    await tx.$queryRaw`SELECT id FROM "NewsletterSubscriber" WHERE id=${pointer.subscriberId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "NewsletterRequest" WHERE id=${id} FOR UPDATE`;
    now = await databaseNow(tx);
    const request = await tx.newsletterRequest.findUniqueOrThrow({ where: { id } }), subscriber = await tx.newsletterSubscriber.findUniqueOrThrow({ where: { id: pointer.subscriberId } });
    if (["SENT", "SUPPRESSED", "DEAD"].includes(request.state)) return null;
    if (request.state === "SENDING" && request.leaseUntil && request.leaseUntil > now) return null;
    if (request.state !== "SENDING" && request.nextAttemptAt > now) return null;
    const suppressed = !["PENDING", "ACTIVE"].includes(subscriber.status) || subscriber.generation !== request.generation || (subscriber.status === "PENDING" && subscriber.confirmationExpiresAt <= now);
    if (suppressed) {
      await tx.newsletterRequest.update({ where: { id }, data: { state: "SUPPRESSED", leaseToken: null, leaseUntil: null, lastErrorCode: subscriber.generation !== request.generation || subscriber.status === "UNSUBSCRIBED" ? "REPLACED" : subscriber.status === "ACTIVE" ? "ALREADY_ACTIVE" : "EXPIRED" } });
      return null;
    }
    if (request.attempts >= 8) { await tx.newsletterRequest.update({ where: { id }, data: { state: "DEAD", leaseToken: null, leaseUntil: null, lastErrorCode: "ATTEMPTS_EXHAUSTED" } }); return null; }
    const leaseToken = randomUUID();
    await tx.newsletterRequest.update({ where: { id }, data: { state: "SENDING", attempts: request.attempts + 1, leaseToken, leaseUntil: new Date(now.getTime() + NEWSLETTER_LEASE_MS), lastErrorCode: null } });
    return { requestId: id, leaseToken, subscriber, attempt: request.attempts + 1 };
  });
}
export type NewsletterDeliveryClaim = NonNullable<Awaited<ReturnType<typeof claimNewsletterDelivery>>>;

export async function finishNewsletterDelivery(claim: NewsletterDeliveryClaim, failureCode: "CONFIGURATION" | "TRANSPORT" | "REJECTED" | null) {
  return transaction(async (tx, now) => {
    const nextAttemptAt = new Date(now.getTime() + Math.min(60 * 60_000, NEWSLETTER_RESEND_MS * 2 ** Math.min(claim.attempt - 1, 10)));
    const updated = await tx.newsletterRequest.updateMany({ where: { id: claim.requestId, state: "SENDING", leaseToken: claim.leaseToken, leaseUntil: { gt: now } }, data: failureCode ? { state: claim.attempt >= 8 ? "DEAD" : "FAILED", leaseToken: null, leaseUntil: null, nextAttemptAt, lastErrorCode: failureCode } : { state: "SENT", leaseToken: null, leaseUntil: null, sentAt: now, lastErrorCode: null } });
    return updated.count === 1;
  });
}

export async function deliverNewsletterRequest(id: string) {
  const claim = await claimNewsletterDelivery(id);
  if (!claim) return false;
  let failure: "CONFIGURATION" | "TRANSPORT" | "REJECTED" | null = null;
  try { await sendNewsletterConfirmation(claim.subscriber.email, claim.subscriber, claim.requestId, claim.subscriber.status === "ACTIVE"); }
  catch (error) {
    failure = error instanceof MailConfigurationError || error instanceof RuntimeConfigurationError || (error instanceof NewsletterError && error.code === "NEWSLETTER_UNAVAILABLE") ? "CONFIGURATION" : error instanceof NewsletterError && error.code === "NEWSLETTER_DELIVERY_REJECTED" ? "REJECTED" : "TRANSPORT";
  }
  const saved = await finishNewsletterDelivery(claim, failure);
  if (failure || !saved) throw new NewsletterError("Confirmation delivery was not confirmed. The request is retained for retry; subscription is not activated by sending email.", 503, "NEWSLETTER_DELIVERY_UNAVAILABLE", 60);
  return true;
}

export async function submitNewsletterSubscription(raw: unknown) {
  const recorded = await recordNewsletterRequest(raw);
  await deliverNewsletterRequest(recorded.id);
  return transaction(async (tx, now) => {
    const saved = await tx.newsletterRequest.findUniqueOrThrow({ where: { id: recorded.id } });
    if (saved.state === "FAILED" || saved.state === "DEAD") throw new NewsletterError("Confirmation delivery is unavailable. The original request is retained; retry later or request fresh instructions after correcting the delivery problem.", 503, saved.state === "DEAD" ? "NEWSLETTER_RETRY_EXHAUSTED" : "NEWSLETTER_DELIVERY_UNAVAILABLE", Math.max(1, Math.min(3600, Math.ceil((saved.nextAttemptAt.getTime() - now.getTime()) / 1000))));
    // A receipt acknowledges only the request. It never exposes recipient
    // membership or claims activation/inbox delivery from SMTP acceptance.
    return { requestId: saved.id, recordedAt: saved.createdAt.toISOString() };
  });
}

export async function changeNewsletterPreference(raw: unknown, action: "CONFIRM" | "UNSUBSCRIBE") {
  const { token } = newsletterTokenMutationSchema.parse(raw), id = token.split(".")[0];
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "NewsletterSubscriber" WHERE id=${id} FOR UPDATE`;
    const now = await databaseNow(tx);
    const subscriber = await tx.newsletterSubscriber.findUnique({ where: { id } });
    if (!subscriber || !validNewsletterToken(subscriber, action, token, now)) throw new NewsletterError("This newsletter link is invalid, replaced or expired.", 400, "NEWSLETTER_INVALID_LINK");
    if (action === "CONFIRM" && subscriber.status === "UNSUBSCRIBED") throw new NewsletterError("This preference was withdrawn. Request a fresh confirmation before subscribing again.", 409, "NEWSLETTER_WITHDRAWN");
    const status = action === "CONFIRM" ? "ACTIVE" : "UNSUBSCRIBED";
    if (subscriber.status !== status) {
      await tx.newsletterEvent.create({ data: { subscriberId: id, version: subscriber.version + 1, generation: subscriber.generation, kind: action === "CONFIRM" ? "CONFIRMED" : "UNSUBSCRIBED", beforeStatus: subscriber.status, afterStatus: status, consentVersion: subscriber.consentVersion } });
      await tx.newsletterSubscriber.update({ where: { id }, data: { status, version: subscriber.version + 1, ...(action === "CONFIRM" ? { confirmedAt: now, unsubscribedAt: null } : { unsubscribedAt: now }) } });
    }
    return { status };
  });
}

export async function sweepNewsletterDeliveries(maximum = 5) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5) throw new NewsletterError("Invalid newsletter sweep bound.", 400, "NEWSLETTER_REQUEST");
  const ids = await transaction(async (tx, now) => tx.newsletterRequest.findMany({ where: { OR: [{ state: { in: ["READY", "FAILED"] }, nextAttemptAt: { lte: now } }, { state: "SENDING", leaseUntil: { lte: now } }] }, orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: maximum, select: { id: true } }));
  const result = { examined: ids.length, delivered: 0, deferred: 0, failed: 0 };
  for (const entry of ids) { try { if (await deliverNewsletterRequest(entry.id)) result.delivered++; else result.deferred++; } catch { result.failed++; } }
  return result;
}
