import type { PrismaClient, User, Product } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { claimNotificationEvent, deliverNotificationClaim, sweepNotificationEvents } from "@/lib/notification-delivery";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("leased notification delivery using actual PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, seller: User, admin: User, product: Product;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [seller, admin] = await Promise.all(["MEMBER", "ADMIN"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@notification-worker.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    const category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } }); product = await mockDatabase.product.create({ data: { name: "Notification worker fixture", slug: randomUUID(), price: 100, stock: 1, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  async function pending() { await mockDatabase.product.update({ where: { id: product.id }, data: { status: "PENDING_APPROVAL" } }); return mockDatabase.notificationEvent.findFirstOrThrow({ where: { kind: "PRODUCT_REVIEW", dedupeKey: { startsWith: `product:${product.id}:` } } }); }
  it("lets one worker own a claim and delivers each source/recipient once", async () => {
    const event = await pending(), claims = await Promise.all([claimNotificationEvent(), claimNotificationEvent()]); expect(claims.filter(Boolean)).toHaveLength(1); const claim = claims.find(Boolean)!;
    const [timing] = await mockDatabase.$queryRaw<{ seconds: number }[]>`SELECT (EXTRACT(EPOCH FROM ("leaseUntil" AT TIME ZONE 'UTC'))-EXTRACT(EPOCH FROM clock_timestamp()))::float8 AS seconds FROM "NotificationEvent" WHERE id=${event.id}`; expect(timing.seconds).toBeGreaterThan(0); expect(timing.seconds).toBeLessThanOrEqual(30);
    expect(await deliverNotificationClaim(claim.id, claim.leaseToken!)).toMatchObject({ state: "DELIVERED", inserted: 1 });
    await expect(deliverNotificationClaim(claim.id, claim.leaseToken!)).rejects.toMatchObject({ code: "STALE_NOTIFICATION_LEASE" }); expect(await mockDatabase.notification.count({ where: { eventId: event.id } })).toBe(1);
    expect(await mockDatabase.notification.findFirst()).toMatchObject({ userId: admin.id, audience: "ADMIN", readAt: null, href: "/admin/products" }); expect((await sweepNotificationEvents()).checked).toBe(0);
  });
  it("checkpoints large administrator fan-out without treating each successful page as another failed attempt", async () => {
    await mockDatabase.user.createMany({ data: Array.from({ length: 110 }, () => ({ email: `${randomUUID()}@admin-page.example.invalid`, role: "ADMIN", isVerified: true })) }); const event = await pending();
    const first = await claimNotificationEvent(); expect(first).not.toBeNull(); const page = await deliverNotificationClaim(first!.id, first!.leaseToken!); expect(page).toEqual({ state: "READY", inserted: 100 });
    const checkpoint = await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: event.id } }); expect(checkpoint).toMatchObject({ state: "READY", attempts: 0, claimCount: 1 }); expect(checkpoint.cursorId).not.toBeNull();
    // Expedite this test's real due timestamp; no application provider/mock path.
    await mockDatabase.notificationEvent.update({ where: { id: event.id }, data: { version: checkpoint.version + 1, nextAttemptAt: new Date(0) } });
    expect(await sweepNotificationEvents()).toMatchObject({ checked: 1, delivered: 1, inserted: 11 }); expect(await mockDatabase.notification.count({ where: { eventId: event.id } })).toBe(111); expect((await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: event.id } })).claimCount).toBe(2);
  });
  it("recovers an expired lease and refuses the old worker token", async () => {
    const event = await pending(), old = await claimNotificationEvent(), claimed = await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: event.id } });
    await mockDatabase.notificationEvent.update({ where: { id: event.id }, data: { version: claimed.version + 1, leaseUntil: new Date(0) } }); const replacement = await claimNotificationEvent(); expect(replacement!.leaseToken).not.toBe(old!.leaseToken);
    await expect(deliverNotificationClaim(old!.id, old!.leaseToken!)).rejects.toMatchObject({ code: "STALE_NOTIFICATION_LEASE" }); await deliverNotificationClaim(replacement!.id, replacement!.leaseToken!); expect(await mockDatabase.notification.count()).toBe(1);
  });
  it("rolls back a failed insert, records retry state and recovers without duplicate inbox content", async () => {
    const event = await pending();
    await mockDatabase.$executeRawUnsafe(`CREATE TABLE "NotificationTestFailure"(blocked BOOLEAN NOT NULL); INSERT INTO "NotificationTestFailure" VALUES (true);`);
    await mockDatabase.$executeRawUnsafe(`CREATE FUNCTION notification_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationTestFailure" WHERE blocked) THEN RAISE EXCEPTION 'Isolated test transport failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER "Notification_test_failure" BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION notification_test_failure();`);
    expect(await sweepNotificationEvents()).toMatchObject({ checked: 1, deferred: 1, inserted: 0 }); expect(await mockDatabase.notification.count()).toBe(0);
    const failed = await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: event.id } }); expect(failed).toMatchObject({ state: "RETRY", attempts: 1, cursorId: null, leaseToken: null, lastErrorCode: "DELIVERY_UNCONFIRMED" });
    await mockDatabase.$executeRaw`UPDATE "NotificationTestFailure" SET blocked=false`; await mockDatabase.notificationEvent.update({ where: { id: event.id }, data: { version: failed.version + 1, nextAttemptAt: new Date(0) } });
    expect(await sweepNotificationEvents()).toMatchObject({ delivered: 1, inserted: 1 }); expect(await mockDatabase.notification.count()).toBe(1);
  });
  it("quarantines invalid immutable event data and labels removed/no-recipient sources without claiming delivery", async () => {
    const bad = await mockDatabase.notificationEvent.create({ data: { dedupeKey: randomUUID(), kind: "PRODUCT_REVIEW", audience: "ADMIN", recipientGroup: "ADMINS", subjectType: "PRODUCT", subjectId: product.id, data: { href: "https://foreign.example.invalid" } } });
    expect(await sweepNotificationEvents()).toMatchObject({ dead: 1, delivered: 0 }); expect(await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: bad.id } })).toMatchObject({ state: "DEAD", lastErrorCode: "INVALID_NOTIFICATION_EVENT" });
    const removed = await pending(); await mockDatabase.product.delete({ where: { id: product.id } }); expect(await sweepNotificationEvents()).toMatchObject({ skipped: 1, delivered: 0 }); expect(await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: removed.id } })).toMatchObject({ state: "SKIPPED", lastErrorCode: "SOURCE_REMOVED" });
    const missing = await mockDatabase.notificationEvent.create({ data: { dedupeKey: randomUUID(), kind: "ACCOUNT_ACCESS", audience: "ACCOUNT", recipientGroup: "DIRECT", recipientId: "missing-owner", subjectType: "ACCOUNT", subjectId: seller.id, data: {} } });
    expect(await sweepNotificationEvents()).toMatchObject({ skipped: 1, delivered: 0 }); expect(await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({ state: "SKIPPED", lastErrorCode: "NO_RECIPIENTS" });
  });
  it("stops after eight unconfirmed attempts and preserves the failed event for operator recovery", async () => {
    const event = await pending();
    await mockDatabase.$executeRawUnsafe(`CREATE FUNCTION notification_attempt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated bounded retry failure'; END $$; CREATE TRIGGER "Notification_attempt_failure" BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION notification_attempt_failure();`);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await sweepNotificationEvents(); expect(result.checked).toBe(1); expect(result.inserted).toBe(0);
      const current = await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: event.id } }); expect(current).toMatchObject({ attempts: attempt, claimCount: attempt, state: attempt === 8 ? "DEAD" : "RETRY" });
      if (attempt < 8) await mockDatabase.notificationEvent.update({ where: { id: event.id }, data: { version: current.version + 1, nextAttemptAt: new Date(0) } }); else expect(result.dead).toBe(1);
    }
    expect((await sweepNotificationEvents()).checked).toBe(0); expect(await mockDatabase.notification.count()).toBe(0);
  });
});
