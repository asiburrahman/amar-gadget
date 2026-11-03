import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { submitSupportMessage, readSupportQueue, readSupportMessage, mutateSupportStatus } from "@/lib/support";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("durable contact submissions and administrator processing", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, customer: User;
  const message = (overrides = {}) => ({ requestId: randomUUID(), name: "Local customer", email: "customer@example.invalid", topic: "ORDER", subject: "Delivery inquiry", message: "Please check the delivery for my order.", consent: true, ...overrides });
  beforeEach(async () => {
    jest.clearAllMocks(); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [admin, customer] = await Promise.all(["ADMIN", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@support.example.invalid`, role, isVerified: true } })));
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });

  it("persists actual text and consent once for competing exact retries without exposing private receipt fields", async () => {
    const input = message({ orderReference: "Unknown reference is not an authorization claim" });
    const receipts = await Promise.all([submitSupportMessage(input), submitSupportMessage(input)]);
    expect(receipts[0]).toEqual(receipts[1]); expect(Object.keys(receipts[0]).sort()).toEqual(["id", "receivedAt"]);
    expect(await mockDatabase.supportMessage.count()).toBe(1);
    const saved = await mockDatabase.supportMessage.findUniqueOrThrow({ where: { id: input.requestId } });
    expect(saved.message).toBe(input.message); expect(saved.consentAt).toEqual(saved.createdAt); expect(saved.status).toBe("OPEN");
    await expect(submitSupportMessage({ ...input, message: "A replacement must never overwrite it" })).rejects.toMatchObject({ status: 409 });
    expect((await mockDatabase.supportMessage.findUniqueOrThrow({ where: { id: input.requestId } })).message).toBe(input.message);
  });

  it("returns actual bounded pages, counts and private detail without trusting a sender's order reference", async () => {
    for (let index = 0; index < 22; index++) await submitSupportMessage(message({ topic: index === 0 ? "WARRANTY" : "ORDER" }));
    const first = await readSupportQueue(admin, {}), second = await readSupportQueue(admin, { page: 2 });
    expect(first).toMatchObject({ total: 22, totalPages: 2, counts: { OPEN: 22, IN_PROGRESS: 0, RESOLVED: 0 } });
    expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(2); expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(22);
    expect(JSON.stringify(first)).not.toContain("customer@example.invalid");
    expect((await readSupportQueue(admin, { topic: "WARRANTY" })).total).toBe(1);
    const detail = await readSupportMessage(admin, first.rows[0].id); expect(detail.message.email).toBe("customer@example.invalid"); expect(detail.message).not.toHaveProperty("contentHash"); expect(detail.history.total).toBe(0);
    await expect(readSupportMessage(customer, first.rows[0].id)).rejects.toMatchObject({ status: 403 });
    await expect(readSupportQueue(admin, { page: 3 })).rejects.toMatchObject({ status: 404 });
  });

  it("records exact status decisions once, rejects stale rivals and retains a real reopen history", async () => {
    const receipt = await submitSupportMessage(message());
    const input = { requestId: randomUUID(), id: receipt.id, version: 1, status: "IN_PROGRESS", reason: "Checking the original shipment record" };
    const results = await Promise.all([mutateSupportStatus(admin, input), mutateSupportStatus(admin, input)]); expect(results[0]).toEqual(results[1]);
    await expect(mutateSupportStatus(admin, { ...input, requestId: randomUUID(), status: "RESOLVED" })).rejects.toMatchObject({ status: 409 });
    await expect(mutateSupportStatus(admin, { ...input, reason: "Different recorded reason" })).rejects.toMatchObject({ status: 409 });
    await mutateSupportStatus(admin, { ...input, requestId: randomUUID(), version: 2, status: "RESOLVED" });
    await mutateSupportStatus(admin, { ...input, requestId: randomUUID(), version: 3, status: "OPEN", reason: "Customer requested a further review" });
    const detail = await readSupportMessage(admin, receipt.id); expect(detail.message).toMatchObject({ version: 4, status: "OPEN" }); expect(detail.history.total).toBe(3);
    expect(detail.history.rows.map((event) => event.afterStatus)).toEqual(["OPEN", "RESOLVED", "IN_PROGRESS"]);
    expect(await mockDatabase.supportRequest.count()).toBe(3);
  });

  it("rechecks changed role, verification and session before private reads or writes", async () => {
    const receipt = await submitSupportMessage(message());
    await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "USER" } });
    await expect(readSupportQueue(admin, {})).rejects.toMatchObject({ status: 403 });
    await expect(mutateSupportStatus(admin, { requestId: randomUUID(), id: receipt.id, version: 1, status: "RESOLVED", reason: "This actor no longer has access" })).rejects.toMatchObject({ status: 403 });
    expect(await mockDatabase.supportMessageEvent.count()).toBe(0);
    const restored = await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await expect(readSupportQueue(admin, {})).rejects.toMatchObject({ status: 403 }); expect((await readSupportQueue(restored, {})).total).toBe(1);
    await mockDatabase.user.update({ where: { id: admin.id }, data: { isVerified: false } });
    await expect(readSupportMessage(restored, receipt.id)).rejects.toMatchObject({ status: 403 });
  });

  it("guards immutable content, audited transitions, retained evidence and transaction rollback at SQL level", async () => {
    const receipt = await submitSupportMessage(message());
    await expect(mockDatabase.supportMessage.update({ where: { id: receipt.id }, data: { message: "A silently replaced original support message" } })).rejects.toThrow();
    await expect(mockDatabase.supportMessage.update({ where: { id: receipt.id }, data: { status: "RESOLVED", version: 2 } })).rejects.toThrow();
    await expect(mockDatabase.supportMessageEvent.create({ data: { messageId: receipt.id, version: 2, actorId: admin.id, beforeStatus: "OPEN", afterStatus: "RESOLVED", reason: "Orphan evidence cannot commit alone" } })).rejects.toThrow();
    expect(await mockDatabase.supportMessageEvent.count()).toBe(0);
    await expect(mockDatabase.$transaction(async (tx) => {
      await tx.supportMessageEvent.create({ data: { messageId: receipt.id, version: 2, actorId: admin.id, beforeStatus: "OPEN", afterStatus: "RESOLVED", reason: "Rolled back status evidence" } });
      await tx.supportMessage.update({ where: { id: receipt.id }, data: { status: "RESOLVED", version: 2 } });
      throw Error("Simulated transaction failure");
    })).rejects.toThrow("Simulated transaction failure");
    expect((await readSupportMessage(admin, receipt.id)).message.version).toBe(1);
    await mutateSupportStatus(admin, { requestId: randomUUID(), id: receipt.id, version: 1, status: "RESOLVED", reason: "Recorded follow-up completed outside this app" });
    await expect(mockDatabase.supportMessageEvent.deleteMany({ where: { messageId: receipt.id } })).rejects.toThrow();
    await expect(mockDatabase.supportMessage.delete({ where: { id: receipt.id } })).rejects.toThrow();
    await expect(mockDatabase.supportRequest.deleteMany()).rejects.toThrow();
  });

  it("wires public persistence and private review with bounded JSON, rate limits and current-viewer authority", async () => {
    const publicRoute = await import("@/app/api/contact/route"), privateRoute = await import("@/app/api/admin/support/route");
    const request = (path: string, body?: unknown, owner = admin.id, contentType = "application/json") => new Request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { "X-Support-Owner": owner, "Content-Type": contentType }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const input = message(), path = "/api/contact", queue = "/api/admin/support";
    const saved = await publicRoute.POST(request(path, input)); expect(saved.status).toBe(201); expect(saved.headers.get("cache-control")).toBe("private, no-store");
    expect((await publicRoute.POST(request(path, { ...input, consent: false }))).status).toBe(400);
    expect((await publicRoute.POST(request(path, input, admin.id, "text/plain"))).status).toBe(415);
    expect((await publicRoute.POST(request(`${path}?owner=forged`, input))).status).toBe(400);
    expect((await publicRoute.POST(request(path, { ...input, message: "x".repeat(50000) }))).status).toBe(413);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); const limited = await publicRoute.POST(request(path, input)); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await privateRoute.GET(request(queue))).status).toBe(403);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    expect((await privateRoute.GET(request(queue, undefined, customer.id))).status).toBe(409);
    expect((await privateRoute.GET(request(`${queue}?status=OPEN&status=RESOLVED`))).status).toBe(400);
    const listed = await privateRoute.GET(request(queue)); expect(listed.status).toBe(200); expect((await listed.json()).total).toBe(1);
    const detail = await privateRoute.GET(request(`${queue}?id=${input.requestId}`)); expect(detail.status).toBe(200); expect((await detail.json()).message.email).toBe(input.email);
    const decision = { requestId: randomUUID(), id: input.requestId, version: 1, status: "IN_PROGRESS", reason: "Reviewing the saved inquiry" };
    expect((await privateRoute.POST(request(queue, decision))).status).toBe(200); expect((await privateRoute.POST(request(queue, { ...decision, requestId: randomUUID() }))).status).toBe(409);
    const privateLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDatabase.$executeRawUnsafe("CREATE FUNCTION test_support_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database credentials and customer content'; END $$");
    await mockDatabase.$executeRawUnsafe('CREATE TRIGGER test_support_failure BEFORE INSERT ON "SupportMessage" FOR EACH ROW EXECUTE FUNCTION test_support_failure()');
    try {
      const unavailable = await publicRoute.POST(request(path, message())); expect(unavailable.status).toBe(503); expect(JSON.stringify(await unavailable.json())).not.toContain("credentials"); expect(JSON.stringify(privateLog.mock.calls)).not.toContain("credentials");
    } finally { privateLog.mockRestore(); }
  });
});
