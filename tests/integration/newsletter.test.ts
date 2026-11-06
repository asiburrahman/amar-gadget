import type { PrismaClient, NewsletterSubscriber } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/mail/send-newsletter-confirmation", () => ({ sendNewsletterConfirmation: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { recordNewsletterRequest, claimNewsletterDelivery, finishNewsletterDelivery, deliverNewsletterRequest, changeNewsletterPreference, sweepNewsletterDeliveries, submitNewsletterSubscription } from "@/lib/newsletter";
import { newsletterToken } from "@/lib/newsletter-policy";
import { sendNewsletterConfirmation } from "@/lib/mail/send-newsletter-confirmation";
import { rateLimit } from "@/lib/rate-limit";
import { getCurrentUserWithRole } from "@/lib/session";
import { readNewsletterAdministration } from "@/lib/newsletter-administration";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("durable newsletter consent and leased provider delivery", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>;
  const originalSecret = process.env.OTP_SECRET;
  const input = (changes = {}) => ({ requestId: randomUUID(), email: `${randomUUID()}@newsletter.example.invalid`, consent: true, ...changes });
  // Only this suite's newly owned random DB is modified. This models elapsed
  // time without a minute-long sleep; DDL restoration is transactionally atomic.
  async function elapsed(id: string, fields: Partial<Pick<NewsletterSubscriber, "lastRequestedAt" | "confirmationExpiresAt">> = { lastRequestedAt: new Date(Date.now() - 61_000) }) {
    await mockDatabase.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "NewsletterSubscriber" DISABLE TRIGGER "NewsletterSubscriber_guard"');
      await tx.newsletterSubscriber.update({ where: { id }, data: fields });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.$executeRawUnsafe('ALTER TABLE "NewsletterSubscriber" ENABLE TRIGGER "NewsletterSubscriber_guard"');
    });
  }
  const savedFor = (email: string) => mockDatabase.newsletterSubscriber.findUniqueOrThrow({ where: { email } });
  beforeEach(async () => { fixture = await createFinanceDatabase(); mockDatabase = fixture.db; process.env.OTP_SECRET = "isolated-newsletter-integration-key-long-enough"; jest.clearAllMocks(); (sendNewsletterConfirmation as jest.Mock).mockResolvedValue(undefined); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  afterAll(() => { if (originalSecret === undefined) delete process.env.OTP_SECRET; else process.env.OTP_SECRET = originalSecret; });

  it("persists consent once for competing exact requests and uses real UTC expiry", async () => {
    const request = input(), outcomes = await Promise.all([recordNewsletterRequest(request), recordNewsletterRequest(request)]); expect(outcomes[0]).toEqual(outcomes[1]);
    const saved = await savedFor(request.email); expect(saved).toMatchObject({ status: "PENDING", version: 1, generation: 1, consentVersion: "newsletter-v1", confirmedAt: null });
    expect(await mockDatabase.newsletterSubscriber.count()).toBe(1); expect(await mockDatabase.newsletterEvent.count()).toBe(1); expect(await mockDatabase.newsletterRequest.count()).toBe(1); expect(sendNewsletterConfirmation).not.toHaveBeenCalled();
    const [clock] = await mockDatabase.$queryRaw<{ seconds: number }[]>`SELECT extract(epoch FROM ("confirmationExpiresAt"-timezone('UTC',clock_timestamp())))::double precision AS seconds FROM "NewsletterSubscriber" WHERE id=${saved.id}`;
    expect(clock.seconds).toBeGreaterThan(86390); expect(clock.seconds).toBeLessThanOrEqual(86400);
    expect(JSON.stringify(await mockDatabase.newsletterRequest.findMany())).not.toContain(newsletterToken(saved, "CONFIRM"));
    await expect(recordNewsletterRequest({ ...request, email: "another@example.invalid" })).rejects.toMatchObject({ status: 409 });
    await expect(recordNewsletterRequest(input({ email: request.email }))).rejects.toMatchObject({ status: 429 });
  });
  it("retains actual provider failure and safely retries without activating the subscription", async () => {
    const request = input(); await recordNewsletterRequest(request); (sendNewsletterConfirmation as jest.Mock).mockRejectedValueOnce(Error("controlled private provider failure"));
    await expect(deliverNewsletterRequest(request.requestId)).rejects.toMatchObject({ status: 503, code: "NEWSLETTER_DELIVERY_UNAVAILABLE" });
    let saved = await mockDatabase.newsletterRequest.findUniqueOrThrow({ where: { id: request.requestId } }); expect(saved).toMatchObject({ state: "FAILED", attempts: 1, leaseToken: null, lastErrorCode: "TRANSPORT", sentAt: null }); expect(saved.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(50000);
    expect(await deliverNewsletterRequest(request.requestId)).toBe(false); expect(sendNewsletterConfirmation).toHaveBeenCalledTimes(1);
    await mockDatabase.newsletterRequest.update({ where: { id: request.requestId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await deliverNewsletterRequest(request.requestId)).toBe(true); saved = await mockDatabase.newsletterRequest.findUniqueOrThrow({ where: { id: request.requestId } }); expect(saved).toMatchObject({ state: "SENT", attempts: 2, lastErrorCode: null }); expect(saved.sentAt).not.toBeNull(); expect((await savedFor(request.email)).status).toBe("PENDING");
  });
  it("claims once, recovers expired leases and rejects stale completion under actual PostgreSQL locks", async () => {
    const request = input(); await recordNewsletterRequest(request);
    const claims = await Promise.all([claimNewsletterDelivery(request.requestId), claimNewsletterDelivery(request.requestId)]); expect(claims.filter(Boolean)).toHaveLength(1); const first = claims.find(Boolean)!;
    const [clock] = await mockDatabase.$queryRaw<{ seconds: number }[]>`SELECT extract(epoch FROM ("leaseUntil"-timezone('UTC',clock_timestamp())))::double precision AS seconds FROM "NewsletterRequest" WHERE id=${request.requestId}`; expect(clock.seconds).toBeGreaterThan(80); expect(clock.seconds).toBeLessThanOrEqual(90);
    await mockDatabase.newsletterRequest.update({ where: { id: request.requestId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const second = (await claimNewsletterDelivery(request.requestId))!; expect(second.leaseToken).not.toBe(first.leaseToken); expect(second.attempt).toBe(2);
    expect(await finishNewsletterDelivery(first, null)).toBe(false); expect(await finishNewsletterDelivery(second, null)).toBe(true); expect(await finishNewsletterDelivery(second, null)).toBe(false);
  });
  it("requires token possession, records idempotent withdrawal and prevents old confirmations reactivating it", async () => {
    const request = input(); await recordNewsletterRequest(request); const subscriber = await savedFor(request.email), confirm = newsletterToken(subscriber, "CONFIRM"), unsubscribe = newsletterToken(subscriber, "UNSUBSCRIBE");
    await expect(changeNewsletterPreference({ token: unsubscribe }, "CONFIRM")).rejects.toMatchObject({ code: "NEWSLETTER_INVALID_LINK" });
    expect(await changeNewsletterPreference({ token: confirm }, "CONFIRM")).toEqual({ status: "ACTIVE" }); expect(await changeNewsletterPreference({ token: confirm }, "CONFIRM")).toEqual({ status: "ACTIVE" });
    expect(await changeNewsletterPreference({ token: unsubscribe }, "UNSUBSCRIBE")).toEqual({ status: "UNSUBSCRIBED" }); expect(await changeNewsletterPreference({ token: unsubscribe }, "UNSUBSCRIBE")).toEqual({ status: "UNSUBSCRIBED" }); expect(await mockDatabase.newsletterEvent.count()).toBe(3);
    await expect(changeNewsletterPreference({ token: confirm }, "CONFIRM")).rejects.toMatchObject({ code: "NEWSLETTER_WITHDRAWN" });
    await elapsed(subscriber.id); await recordNewsletterRequest(input({ email: request.email })); const renewed = await savedFor(request.email); expect(renewed).toMatchObject({ status: "PENDING", generation: 2, confirmedAt: null });
    await expect(changeNewsletterPreference({ token: confirm }, "CONFIRM")).rejects.toMatchObject({ code: "NEWSLETTER_INVALID_LINK" });
    expect(await changeNewsletterPreference({ token: unsubscribe }, "UNSUBSCRIBE")).toEqual({ status: "UNSUBSCRIBED" });
  });
  it("sends an existing subscriber a management link without another activation and supports signing-key rotation", async () => {
    const request = input(); await recordNewsletterRequest(request); const subscriber = await savedFor(request.email); await changeNewsletterPreference({ token: newsletterToken(subscriber, "CONFIRM") }, "CONFIRM");
    await elapsed(subscriber.id); process.env.OTP_SECRET = "rotated-isolated-newsletter-signing-key-long-enough";
    const manage = input({ email: request.email }); await recordNewsletterRequest(manage); expect(await deliverNewsletterRequest(manage.requestId)).toBe(true); expect(sendNewsletterConfirmation).toHaveBeenLastCalledWith(request.email, expect.objectContaining({ status: "ACTIVE", generation: 1 }), manage.requestId, true); expect(await mockDatabase.newsletterEvent.count()).toBe(2);
    expect(await changeNewsletterPreference({ token: newsletterToken(await savedFor(request.email), "UNSUBSCRIBE") }, "UNSUBSCRIBE")).toEqual({ status: "UNSUBSCRIBED" });
  });
  it("suppresses withdrawn/expired queued requests and makes repeated transport failure terminal without fake delivery", async () => {
    const request = input(); await recordNewsletterRequest(request); const subscriber = await savedFor(request.email); await changeNewsletterPreference({ token: newsletterToken(subscriber, "UNSUBSCRIBE") }, "UNSUBSCRIBE");
    expect(await deliverNewsletterRequest(request.requestId)).toBe(false); expect(sendNewsletterConfirmation).not.toHaveBeenCalled(); expect((await mockDatabase.newsletterRequest.findUniqueOrThrow({ where: { id: request.requestId } })).state).toBe("SUPPRESSED");
    const failing = input(); await recordNewsletterRequest(failing); (sendNewsletterConfirmation as jest.Mock).mockRejectedValue(Error("controlled transport failure"));
    for (let attempt = 0; attempt < 8; attempt++) { await mockDatabase.newsletterRequest.update({ where: { id: failing.requestId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }); await expect(deliverNewsletterRequest(failing.requestId)).rejects.toMatchObject({ status: 503 }); }
    expect((await mockDatabase.newsletterRequest.findUniqueOrThrow({ where: { id: failing.requestId } })).state).toBe("DEAD"); expect(await deliverNewsletterRequest(failing.requestId)).toBe(false); expect((await savedFor(failing.email)).status).toBe("PENDING");
    expect(await sweepNewsletterDeliveries(5)).toEqual({ examined: 0, delivered: 0, deferred: 0, failed: 0 }); await expect(sweepNewsletterDeliveries(6)).rejects.toThrow();
  });
  it("rejects orphan state/evidence, forged final delivery and deletion of actual consent history", async () => {
    const request = input(); await recordNewsletterRequest(request); const subscriber = await savedFor(request.email);
    await expect(mockDatabase.newsletterSubscriber.update({ where: { id: subscriber.id }, data: { status: "ACTIVE", confirmedAt: new Date(), version: 2 } })).rejects.toThrow();
    await expect(mockDatabase.newsletterEvent.create({ data: { subscriberId: subscriber.id, version: 2, generation: 1, kind: "CONFIRMED", beforeStatus: "PENDING", afterStatus: "ACTIVE", consentVersion: "newsletter-v1" } })).rejects.toThrow(); expect((await savedFor(request.email)).status).toBe("PENDING");
    await expect(mockDatabase.newsletterRequest.update({ where: { id: request.requestId }, data: { state: "SENT", sentAt: new Date() } })).rejects.toThrow();
    await expect(mockDatabase.newsletterEvent.deleteMany()).rejects.toThrow(); await expect(mockDatabase.newsletterRequest.deleteMany()).rejects.toThrow(); await expect(mockDatabase.newsletterSubscriber.deleteMany()).rejects.toThrow();
  });
  it("rejects an expired capability and renews an expired pending request with a fresh generation", async () => {
    const request = input(); await recordNewsletterRequest(request); const subscriber = await savedFor(request.email);
    await elapsed(subscriber.id, { lastRequestedAt: new Date(Date.now() - 61_000), confirmationExpiresAt: new Date(Date.now() - 1000) });
    const expired = await savedFor(request.email), old = newsletterToken(expired, "CONFIRM"); await expect(changeNewsletterPreference({ token: old }, "CONFIRM")).rejects.toMatchObject({ code: "NEWSLETTER_INVALID_LINK" }); expect(await deliverNewsletterRequest(request.requestId)).toBe(false);
    const renewedRequest = input({ email: request.email }); await recordNewsletterRequest(renewedRequest); const renewed = await savedFor(request.email); expect(renewed.generation).toBe(2); expect(renewed.confirmationNonce).not.toBe(expired.confirmationNonce);
    expect(await deliverNewsletterRequest(renewedRequest.requestId)).toBe(true); await expect(changeNewsletterPreference({ token: old }, "CONFIRM")).rejects.toMatchObject({ code: "NEWSLETTER_INVALID_LINK" }); expect(await changeNewsletterPreference({ token: newsletterToken(renewed, "CONFIRM") }, "CONFIRM")).toEqual({ status: "ACTIVE" });
  });
  it("keeps withdrawal authoritative during a concurrent confirmation or an already in-flight provider call", async () => {
    const request = input(); await recordNewsletterRequest(request); const subscriber = await savedFor(request.email), confirm = newsletterToken(subscriber, "CONFIRM"), unsubscribe = newsletterToken(subscriber, "UNSUBSCRIBE");
    await Promise.allSettled([changeNewsletterPreference({ token: confirm }, "CONFIRM"), changeNewsletterPreference({ token: unsubscribe }, "UNSUBSCRIBE")]); expect((await savedFor(request.email)).status).toBe("UNSUBSCRIBED");
    const another = input(); await recordNewsletterRequest(another); const pendingSubscriber = await savedFor(another.email);
    let release!: () => void, started!: () => void; const receiving = new Promise<void>((resolve) => { started = resolve; });
    (sendNewsletterConfirmation as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; started(); }));
    const sending = deliverNewsletterRequest(another.requestId); await receiving;
    try { expect(await changeNewsletterPreference({ token: newsletterToken(pendingSubscriber, "UNSUBSCRIBE") }, "UNSUBSCRIBE")).toEqual({ status: "UNSUBSCRIBED" }); }
    finally { release(); await sending; }
    expect((await savedFor(another.email)).status).toBe("UNSUBSCRIBED"); expect((await mockDatabase.newsletterRequest.findUniqueOrThrow({ where: { id: another.requestId } })).state).toBe("SENT");
  });
  it("returns a minimal durable request receipt and never converts SMTP acceptance or a failed retry into activation", async () => {
    const request = input(), receipt = await submitNewsletterSubscription(request); expect(Object.keys(receipt).sort()).toEqual(["recordedAt", "requestId"]); expect(receipt.requestId).toBe(request.requestId); expect((await savedFor(request.email)).status).toBe("PENDING"); expect(await submitNewsletterSubscription(request)).toEqual(receipt); expect(sendNewsletterConfirmation).toHaveBeenCalledTimes(1);
    const failed = input(); (sendNewsletterConfirmation as jest.Mock).mockRejectedValueOnce(Error("controlled provider refusal")); await expect(submitNewsletterSubscription(failed)).rejects.toMatchObject({ status: 503 }); await expect(submitNewsletterSubscription(failed)).rejects.toMatchObject({ status: 503 }); expect((await savedFor(failed.email)).status).toBe("PENDING"); expect(sendNewsletterConfirmation).toHaveBeenCalledTimes(2);
  });
  it("wires bounded consent/confirmation/withdrawal handlers without public membership or provider diagnostics", async () => {
    const subscribe = await import("@/app/api/newsletter/route"), confirm = await import("@/app/api/newsletter/confirm/route"), unsubscribe = await import("@/app/api/newsletter/unsubscribe/route");
    const request = (body: unknown, path = "/api/newsletter", type = "application/json") => new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(body) });
    const intent = input(), accepted = await subscribe.POST(request(intent)); expect(accepted.status).toBe(202); expect(accepted.headers.get("cache-control")).toBe("private, no-store"); expect(accepted.headers.get("referrer-policy")).toBe("no-referrer"); const receipt = await accepted.json(); expect(receipt.receipt.requestId).toBe(intent.requestId); expect(JSON.stringify(receipt)).not.toContain(intent.email);
    const subscriber = await savedFor(intent.email); expect(subscriber.status).toBe("PENDING");
    expect((await confirm.POST(request({ token: newsletterToken(subscriber, "CONFIRM") }))).status).toBe(200); expect((await savedFor(intent.email)).status).toBe("ACTIVE"); expect((await unsubscribe.POST(request({ token: newsletterToken(subscriber, "UNSUBSCRIBE") }))).status).toBe(200); expect((await savedFor(intent.email)).status).toBe("UNSUBSCRIBED"); expect("GET" in confirm).toBe(false); expect("GET" in unsubscribe).toBe(false);
    expect((await subscribe.POST(request({ ...input(), consent: false }))).status).toBe(400); expect((await subscribe.POST(request(input(), "/api/newsletter?recipient=foreign"))).status).toBe(400); expect((await subscribe.POST(request(input(), "/api/newsletter", "text/plain"))).status).toBe(415); expect((await subscribe.POST(request({ padding: "x".repeat(3000) }))).status).toBe(413);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); const limited = await subscribe.POST(request(input())); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBeTruthy();
    (sendNewsletterConfirmation as jest.Mock).mockRejectedValueOnce(Error("controlled private SMTP credential marker")); const failed = await subscribe.POST(request(input())); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("credential marker");
  });
  it("returns real bounded private subscriber/delivery pages and counts without capabilities or raw errors", async () => {
    const admin = await mockDatabase.user.create({ data: { email: `${randomUUID()}@newsletter-admin.example.invalid`, role: "ADMIN", isVerified: true } });
    for (let index = 0; index < 22; index++) await recordNewsletterRequest(input());
    const first = await readNewsletterAdministration(admin, { mode: "SUBSCRIBERS" }), second = await readNewsletterAdministration(admin, { mode: "SUBSCRIBERS", page: 2 });
    expect(first).toMatchObject({ total: 22, totalPages: 2, counts: { PENDING: 22, ACTIVE: 0, UNSUBSCRIBED: 0 } }); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(2); expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(22);
    const serialized = JSON.stringify(first); for (const privateField of ["confirmationNonce", "unsubscribeNonce", "contentHash", "leaseToken"]) expect(serialized).not.toContain(privateField);
    const pending = await mockDatabase.newsletterSubscriber.findFirstOrThrow(); await changeNewsletterPreference({ token: newsletterToken(pending, "CONFIRM") }, "CONFIRM");
    expect(await readNewsletterAdministration(admin, { mode: "SUBSCRIBERS", status: "ACTIVE" })).toMatchObject({ total: 1, counts: { PENDING: 21, ACTIVE: 1, UNSUBSCRIBED: 0 } });
    const deliveries = await readNewsletterAdministration(admin, { mode: "DELIVERIES", state: "READY" }); expect(deliveries).toMatchObject({ total: 22, totalPages: 2 }); expect(deliveries.rows).toHaveLength(20); expect(JSON.stringify(deliveries)).not.toContain("leaseToken"); await expect(readNewsletterAdministration(admin, { mode: "DELIVERIES", page: 3 })).rejects.toMatchObject({ status: 404 });
  });
  it("rechecks current role/session and wires private admin filters/current-viewer boundaries", async () => {
    const admin = await mockDatabase.user.create({ data: { email: `${randomUUID()}@newsletter-admin.example.invalid`, role: "ADMIN", isVerified: true } }), customer = await mockDatabase.user.create({ data: { email: `${randomUUID()}@newsletter-customer.example.invalid`, isVerified: true } });
    await recordNewsletterRequest(input()); await expect(readNewsletterAdministration(customer, { mode: "SUBSCRIBERS" })).rejects.toMatchObject({ status: 403 });
    const route = await import("@/app/api/admin/newsletter/route"), request = (query = "", owner = admin.id) => new Request(`http://localhost/api/admin/newsletter${query}`, { headers: { "X-Newsletter-Owner": owner } });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); const result = await route.GET(request()); expect(result.status).toBe(200); expect((await result.json()).total).toBe(1); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect((await route.GET(request("", customer.id))).status).toBe(409); expect((await route.GET(request("?mode=DELIVERIES&status=ACTIVE"))).status).toBe(400); expect((await route.GET(request("?page=1&page=2"))).status).toBe(400);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await route.GET(request())).status).toBe(403);
    await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "USER" } }); await expect(readNewsletterAdministration(admin, { mode: "SUBSCRIBERS" })).rejects.toMatchObject({ status: 403 });
  });
});
