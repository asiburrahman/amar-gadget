import type { PrismaClient, User, Product } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { sweepNotificationEvents } from "@/lib/notification-delivery";
import { readNotifications, mutateNotifications, readNotificationQueue, retryNotificationEvent } from "@/lib/notifications";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("current-account scoped inbox and administrator delivery recovery", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, buyer: User, seller: User, admin: User, stranger: User, product: Product;
  beforeEach(async () => {
    jest.clearAllMocks(); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [buyer, seller, admin, stranger] = await Promise.all(["USER", "MEMBER", "ADMIN", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@inbox.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    const category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } }); product = await mockDatabase.product.create({ data: { name: "Actual inbox product", slug: randomUUID(), price: 100, stock: 5, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    await mockDatabase.order.create({ data: { userId: buyer.id, total: 100, status: "PROCESSING", paymentMethod: "COD", subtotalCents: BigInt(10000), discountCents: BigInt(0), shippingCents: BigInt(0), pricingEvidence: "Actual isolated purchase", pricingReconciledAt: new Date(), items: { create: [{ productId: product.id, quantity: 1, price: 100, netCents: BigInt(10000) }] } } });
    await mockDatabase.product.update({ where: { id: product.id }, data: { status: "REJECTED" } }); await sweepNotificationEvents(20);
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it("returns only delivered owned notices and exact unread totals for each current role", async () => {
    const customer = await readNotifications(buyer, {}), vendor = await readNotifications(seller, {}), operator = await readNotifications(admin, {});
    expect(customer).toMatchObject({ ownerId: buyer.id, total: 1, unread: 1 }); expect(customer.rows.every((row) => row.audience === "ACCOUNT")).toBe(true);
    expect(vendor).toMatchObject({ total: 2, unread: 2 }); expect(vendor.rows.every((row) => row.audience === "SELLER")).toBe(true); expect(operator).toMatchObject({ total: 1, unread: 1 }); expect(operator.rows[0].audience).toBe("ADMIN");
    expect((await readNotifications(stranger, {})).totalNotifications).toBe(0); expect(JSON.stringify(customer)).not.toContain(seller.email); expect(JSON.stringify(vendor)).not.toContain(buyer.email);
    await expect(readNotifications(buyer, { userId: seller.id })).rejects.toThrow(); await expect(readNotifications(buyer, { page: 2 })).rejects.toMatchObject({ code: "NOTIFICATION_PAGE" });
  });
  it("keeps read changes naturally idempotent and rejects stale reversals or an atomically stale page", async () => {
    const inbox = await readNotifications(seller, {}), [first, second] = inbox.rows;
    expect(await mutateNotifications(seller, { action: "read", id: first.id, version: 0 })).toMatchObject({ changed: 1 }); expect(await mutateNotifications(seller, { action: "read", id: first.id, version: 0 })).toMatchObject({ changed: 0 });
    await expect(mutateNotifications(seller, { action: "unread", id: first.id, version: 0 })).rejects.toMatchObject({ code: "NOTIFICATION_CHANGED" });
    await mutateNotifications(seller, { action: "unread", id: first.id, version: 1 });
    await expect(mutateNotifications(seller, { action: "read-page", entries: [{ id: first.id, version: 0 }, { id: second.id, version: 0 }] })).rejects.toMatchObject({ code: "NOTIFICATION_CHANGED" }); expect((await readNotifications(seller, {})).unread).toBe(2);
    expect(await mutateNotifications(seller, { action: "read-page", entries: [{ id: first.id, version: 2 }, { id: second.id, version: 0 }] })).toMatchObject({ changed: 2 }); expect(await readNotifications(seller, { filter: "UNREAD" })).toMatchObject({ unread: 0, total: 0, totalNotifications: 2 }); expect((await readNotifications(seller, { filter: "READ" })).total).toBe(2);
  });
  it("rejects foreign IDs and mixed-ownership batches before changing any owned notice", async () => {
    const own = (await readNotifications(seller, {})).rows[0], foreign = (await readNotifications(buyer, {})).rows[0];
    await expect(mutateNotifications(seller, { action: "read", id: foreign.id, version: 0 })).rejects.toMatchObject({ status: 404 });
    await expect(mutateNotifications(seller, { action: "read-page", entries: [{ id: own.id, version: 0 }, { id: foreign.id, version: 0 }] })).rejects.toMatchObject({ status: 404 }); expect((await readNotifications(seller, {})).unread).toBe(2);
    await expect(mutateNotifications(seller, { action: "read", id: own.id, version: 0, readAt: "2026-01-01", userId: seller.id })).rejects.toThrow();
  });
  it("rechecks role/session authority, hides former administrator audiences and keeps blocked-seller decisions readable", async () => {
    const privileged = (await readNotifications(admin, {})).rows[0]; const demoted = await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "USER" } });
    await expect(readNotifications(admin, {})).rejects.toMatchObject({ status: 403 }); expect((await readNotifications(demoted, {})).rows).toHaveLength(0); await expect(mutateNotifications(demoted, { action: "read", id: privileged.id, version: 0 })).rejects.toMatchObject({ status: 404 });
    const blockedActor = await mockDatabase.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); await expect(readNotifications(seller, {})).rejects.toMatchObject({ status: 403 }); await sweepNotificationEvents(20); const blocked = await readNotifications(blockedActor, {}); expect(blocked.rows.some((row) => row.kind === "SELLER_STATUS" && row.body.includes("blocked"))).toBe(true);
    await mockDatabase.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } }); await expect(readNotifications(buyer, {})).rejects.toMatchObject({ status: 403 });
  });
  it("shows real delivery failures only to administrators and audits bounded requeue without duplicate delivery", async () => {
    await mockDatabase.product.update({ where: { id: product.id }, data: { status: "PENDING_APPROVAL" } });
    await mockDatabase.$executeRawUnsafe(`CREATE TABLE "NotificationInboxFailure"(blocked BOOLEAN NOT NULL); INSERT INTO "NotificationInboxFailure" VALUES (true); CREATE FUNCTION notification_inbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationInboxFailure" WHERE blocked) THEN RAISE EXCEPTION 'Isolated inbox fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER "Notification_inbox_failure" BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION notification_inbox_failure();`);
    expect(await sweepNotificationEvents()).toMatchObject({ deferred: 1 }); await expect(readNotificationQueue(seller, {})).rejects.toMatchObject({ status: 403 });
    const queue = await readNotificationQueue(admin, {}); expect(queue.total).toBe(1); expect(queue.counts.RETRY).toBe(1); expect(queue.rows[0]).toMatchObject({ state: "RETRY", deliveredRecipients: 0, lastErrorCode: "DELIVERY_UNCONFIRMED" }); expect(queue.rows[0]).not.toHaveProperty("data");
    const event = queue.rows[0], body = { id: event.id, version: event.version, reason: "Verified local database delivery recovery" }; await expect(retryNotificationEvent(buyer, body)).rejects.toMatchObject({ status: 403 });
    await mockDatabase.$executeRaw`UPDATE "NotificationInboxFailure" SET blocked=false`;
    expect(await retryNotificationEvent(admin, body)).toMatchObject({ requeued: true }); expect(await retryNotificationEvent(admin, body)).toMatchObject({ requeued: false }); expect(await mockDatabase.notificationRetryEvent.count({ where: { eventId: event.id } })).toBe(1);
    const [timing] = await mockDatabase.$queryRaw<{ seconds: number }[]>`SELECT (EXTRACT(EPOCH FROM ("nextAttemptAt" AT TIME ZONE 'UTC'))-EXTRACT(EPOCH FROM clock_timestamp()))::float8 AS seconds FROM "NotificationEvent" WHERE id=${event.id}`; expect(timing.seconds).toBeLessThanOrEqual(0); expect(timing.seconds).toBeGreaterThan(-10);
    const resumed = await sweepNotificationEvents(), after = await mockDatabase.notificationEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect({ summary: resumed, state: after.state, errorCode: after.lastErrorCode, attempts: after.attempts, dueInMs: after.nextAttemptAt.getTime() - Date.now() }).toMatchObject({ summary: { delivered: 1, inserted: 1 }, state: "DELIVERED", errorCode: null }); expect((await readNotificationQueue(admin, {})).total).toBe(0);
    await expect(retryNotificationEvent(admin, body)).rejects.toMatchObject({ code: "NOTIFICATION_CHANGED" });
  });
  it("wires real private inbox and queue handlers with current-viewer, body, filter and rate boundaries", async () => {
    const inbox = await import("@/app/api/notifications/route"), queue = await import("@/app/api/admin/notifications/queue/route");
    const request = (query = "", body?: unknown, owner = buyer.id) => new Request(`http://localhost/api/notifications${query}`, { method: body ? "POST" : "GET", headers: { "X-Notification-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(buyer);
    const initial = await inbox.GET(request()); expect(initial.status).toBe(200); expect(initial.headers.get("cache-control")).toBe("private, no-store"); expect((await initial.json()).unread).toBe(1);
    expect((await inbox.GET(request("", undefined, seller.id))).status).toBe(409); expect((await inbox.GET(request("?filter=ALL&filter=UNREAD"))).status).toBe(400); expect((await inbox.GET(request("?userId=foreign"))).status).toBe(400);
    const own = (await readNotifications(buyer, {})).rows[0]; expect((await inbox.POST(request("", { action: "read", id: own.id, version: 0, userId: buyer.id }))).status).toBe(400); expect((await inbox.POST(request("", { action: "read", id: own.id, version: 0 }))).status).toBe(200);
    expect((await inbox.POST(request("", { padding: "x".repeat(16385) }))).status).toBe(413); expect((await queue.GET(request())).status).toBe(403);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); expect((await queue.GET(request("", undefined, admin.id))).status).toBe(200); expect(getCurrentUserWithRole).toHaveBeenLastCalledWith(["ADMIN"]);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); const limited = await inbox.GET(request()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBeTruthy(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await inbox.GET(request())).status).toBe(403);
  });
});
