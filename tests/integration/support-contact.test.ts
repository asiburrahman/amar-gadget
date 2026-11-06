import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readPublicSupportContact, readSupportContactSettings, saveSupportContactSettings } from "@/lib/support-contact";
import { getCurrentUserWithRole } from "@/lib/session";
const fields = { email: "support@example.invalid", phone: "+880 1700 123456", address: "Operator-confirmed local office", hours: "Sunday to Thursday, 10:00-18:00 Asia/Dhaka", published: true };
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("administrator managed public support contacts", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, customer: User;
  const input = (changes = {}) => ({ requestId: randomUUID(), version: 0, fields, verified: true, reason: "Reviewed the public contact information", ...changes });
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [admin, customer] = await Promise.all(["ADMIN", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@contacts.example.invalid`, role, isVerified: true } })));
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it("starts unpublished, saves an actual draft, publishes verified details and hides them immediately", async () => {
    expect(await readPublicSupportContact()).toBeNull(); expect((await readSupportContactSettings(admin)).settings).toBeNull();
    await saveSupportContactSettings(admin, input({ fields: { ...fields, published: false }, verified: false })); expect(await readPublicSupportContact()).toBeNull();
    await saveSupportContactSettings(admin, input({ version: 1 })); expect(await readPublicSupportContact()).toEqual(fields);
    await saveSupportContactSettings(admin, input({ version: 2, fields: { ...fields, email: null, phone: null, published: false }, verified: false })); expect(await readPublicSupportContact()).toBeNull();
    const view = await readSupportContactSettings(admin); expect(view.settings).toMatchObject({ version: 3, email: null, published: false }); expect(view.history.total).toBe(3); expect(view.history.rows[0].actorId).toBe(admin.id);
  });
  it("serializes initial editors and exact retries, rejects stale or reused decisions and unverified publishing", async () => {
    const intent = input(), results = await Promise.all([saveSupportContactSettings(admin, intent), saveSupportContactSettings(admin, intent)]); expect(results[0]).toEqual(results[1]); expect(await mockDatabase.supportContactEvent.count()).toBe(1);
    await expect(saveSupportContactSettings(admin, input())).rejects.toMatchObject({ status: 409 });
    await expect(saveSupportContactSettings(admin, { ...intent, reason: "Conflicting reuse of the same identity" })).rejects.toMatchObject({ status: 409 });
    await expect(saveSupportContactSettings(admin, input({ version: 1, verified: false }))).rejects.toThrow();
    await expect(saveSupportContactSettings(admin, input({ version: 1 }))).rejects.toMatchObject({ status: 409 });
    const rival = await Promise.allSettled([saveSupportContactSettings(admin, input({ version: 1, fields: { ...fields, hours: "Morning hours" } })), saveSupportContactSettings(admin, input({ version: 1, fields: { ...fields, hours: "Evening hours" } }))]); expect(rival.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(await mockDatabase.supportContactEvent.count()).toBe(2);
  });
  it("rejects current foreign roles and revoked administrator sessions before reading drafts or saving", async () => {
    await expect(readSupportContactSettings(customer)).rejects.toMatchObject({ status: 403 }); await expect(saveSupportContactSettings(customer, input())).rejects.toMatchObject({ status: 403 });
    await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "USER" } }); await expect(saveSupportContactSettings(admin, input())).rejects.toMatchObject({ status: 403 }); expect(await mockDatabase.supportContactSettings.count()).toBe(0);
  });
  it("requires retained matching publication evidence and rolls back orphan changes", async () => {
    await saveSupportContactSettings(admin, input());
    await expect(mockDatabase.supportContactSettings.update({ where: { id: "PUBLIC" }, data: { phone: "+1234567890", version: 2 } })).rejects.toThrow();
    await expect(mockDatabase.supportContactSettings.deleteMany()).rejects.toThrow(); await expect(mockDatabase.supportContactEvent.deleteMany()).rejects.toThrow();
    const saved = await mockDatabase.supportContactSettings.findUniqueOrThrow({ where: { id: "PUBLIC" } });
    const before = { id: saved.id, email: saved.email, phone: saved.phone, address: saved.address, hours: saved.hours, published: saved.published, version: saved.version };
    await expect(mockDatabase.supportContactEvent.create({ data: { version: 2, actorId: admin.id, before, after: { ...before, version: 2, hours: "Uncommitted replacement" }, verified: true, reason: "Orphan change cannot commit alone" } })).rejects.toThrow();
    expect(await mockDatabase.supportContactEvent.count()).toBe(1);
  });
  it("wires the real private settings handler with strict queries, owner binding and saved receipts", async () => {
    const route = await import("@/app/api/admin/support/contact-settings/route");
    const request = (body?: unknown, owner = admin.id, query = "") => new Request(`http://localhost/api/admin/support/contact-settings${query}`, { method: body ? "POST" : "GET", headers: { "X-Support-Owner": owner, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); expect((await route.GET(request())).status).toBe(200); expect((await route.GET(request(undefined, customer.id))).status).toBe(409); expect((await route.GET(request(undefined, admin.id, "?page=1&page=2"))).status).toBe(400);
    const saved = await route.POST(request(input())); expect(saved.status).toBe(200); expect(saved.headers.get("cache-control")).toBe("private, no-store"); expect((await readPublicSupportContact())?.email).toBe(fields.email);
    expect((await route.POST(request({ ...input({ version: 1 }), fields: { ...fields, email: "javascript:alert(1)" } }))).status).toBe(400);
  });
});
