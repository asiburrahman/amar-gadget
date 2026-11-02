import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { mutateAccountAdministration, readAccountAdministration } from "@/lib/account-administration";
import { signJwtToken } from "@/lib/session-token";
import { validateSessionToken } from "@/lib/session-validation";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { hashPassword } from "@/lib/password";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("account administration against actual PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, seller: User, customer: User;
  beforeEach(async () => {
    database = await createFinanceDatabase(); mockDatabase = database.db;
    const password = await hashPassword(randomUUID());
    [admin, seller, customer] = await Promise.all(["ADMIN", "MEMBER", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@accounts.example.invalid`, role, isVerified: true, password, sellerStatus: role === "MEMBER" ? "PENDING" : "APPROVED" } })));
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
  }, 30_000);
  afterEach(async () => { await database?.close(); });
  const identity = (user: User) => ({ id: user.id, version: user.administrationVersion, requestId: randomUUID(), confirmed: true, reason: "Operator reviewed the actual account" });
  it("protects the last administrator, rejects unusable promotions and rechecks actual authority", async () => {
    await expect(mutateAccountAdministration(admin, { ...identity(admin), action: "role", role: "USER" })).rejects.toMatchObject({ code: "ADMIN_LAST_ADMIN" });
    await mockDatabase.user.create({ data: { email: `${randomUUID()}@accounts.example.invalid`, role: "ADMIN", isVerified: true, password: "unsupported-imported-credential" } });
    await expect(mutateAccountAdministration(admin, { ...identity(admin), action: "role", role: "USER" })).rejects.toMatchObject({ code: "ADMIN_LAST_ADMIN" });
    await mockDatabase.user.update({ where: { id: customer.id }, data: { isVerified: false } });
    const current = await mockDatabase.user.findUniqueOrThrow({ where: { id: customer.id } });
    await expect(mutateAccountAdministration(admin, { ...identity(current), action: "role", role: "ADMIN" })).rejects.toMatchObject({ code: "ADMIN_PROMOTION_UNAVAILABLE" });
    const unsupported = await mockDatabase.user.update({ where: { id: customer.id }, data: { isVerified: true, password: "unsupported-imported-credential" } });
    await expect(mutateAccountAdministration(admin, { ...identity(unsupported), action: "role", role: "ADMIN" })).rejects.toMatchObject({ code: "ADMIN_PROMOTION_UNAVAILABLE" });
    await expect(readAccountAdministration(seller, {})).rejects.toMatchObject({ status: 403 });
    await mockDatabase.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(readAccountAdministration(admin, {})).rejects.toMatchObject({ code: "ADMIN_ACCOUNT_CHANGED" });
  });
  it("serializes two administrators demoting themselves and retains one usable administrator", async () => {
    const second = await mockDatabase.user.create({ data: { email: `${randomUUID()}@accounts.example.invalid`, role: "ADMIN", isVerified: true, password: admin.password } });
    const outcomes = await Promise.allSettled([mutateAccountAdministration(admin, { ...identity(admin), action: "role", role: "USER" }), mutateAccountAdministration(second, { ...identity(second), action: "role", role: "USER" })]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "ADMIN_LAST_ADMIN" } });
    expect(await mockDatabase.user.count({ where: { role: "ADMIN", isVerified: true } })).toBe(1);
  });
  it("finds supported administrator credentials beyond the first bounded page of invalid imports", async () => {
    await mockDatabase.user.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ id: `invalid-admin-${String(index).padStart(3, "0")}`, email: `${index}-${randomUUID()}@accounts.example.invalid`, role: "ADMIN", isVerified: true, password: "unsupported-imported-credential" })) });
    await mockDatabase.user.create({ data: { id: "z-supported-admin", email: `${randomUUID()}@accounts.example.invalid`, role: "ADMIN", isVerified: true, password: admin.password } });
    expect(await mutateAccountAdministration(admin, { ...identity(admin), action: "role", role: "USER" })).toMatchObject({ result: { sessionChanged: true }, row: { role: "USER" } });
  });
  it("deduplicates exact requests, rejects conflicting content and retains sanitized reasoned history", async () => {
    const input = { ...identity(seller), action: "seller-status", sellerStatus: "APPROVED" }, [result, duplicate] = await Promise.all([mutateAccountAdministration(admin, input), mutateAccountAdministration(admin, input)]);
    expect(duplicate).toEqual(result); expect(result.row).toMatchObject({ sellerStatus: "APPROVED", administrationVersion: 2 });
    await expect(mutateAccountAdministration(admin, { ...input, sellerStatus: "BLOCKED" })).rejects.toMatchObject({ code: "ADMIN_REQUEST_CONFLICT" });
    const history = await readAccountAdministration(admin, { mode: "history", id: seller.id }); expect(history.events).toHaveLength(1); expect(history.events[0]).toMatchObject({ actorId: admin.id, reason: input.reason, before: { sellerStatus: "PENDING" }, after: { sellerStatus: "APPROVED" } });
    expect(JSON.stringify(history)).not.toContain(admin.password!); expect(JSON.stringify(result.row)).not.toContain("password");
    await expect(mockDatabase.accountAdminEvent.deleteMany({ where: { userId: seller.id } })).rejects.toThrow();
    await expect(mockDatabase.accountAdminRequest.delete({ where: { id: input.requestId } })).rejects.toThrow();
  });
  it("invalidates real signed cookies after seller moderation, role changes and session revocation", async () => {
    process.env.JWT_SECRET = "isolated-account-administration-session-key-32-bytes";
    const token = await signJwtToken(seller); expect(await validateSessionToken(token)).toMatchObject({ id: seller.id });
    await mutateAccountAdministration(admin, { ...identity(seller), action: "seller-status", sellerStatus: "BLOCKED" }); expect(await validateSessionToken(token)).toBeNull();
    const before = await mockDatabase.user.findUniqueOrThrow({ where: { id: customer.id } }), old = await signJwtToken(before);
    await mutateAccountAdministration(admin, { ...identity(before), action: "role", role: "MEMBER" }); expect(await validateSessionToken(old)).toBeNull(); expect(await mockDatabase.user.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({ role: "MEMBER", sellerStatus: "PENDING" });
    const member = await mockDatabase.user.findUniqueOrThrow({ where: { id: customer.id } }), signed = await signJwtToken(member);
    await mutateAccountAdministration(admin, { ...identity(member), action: "revoke-sessions" }); expect(await validateSessionToken(signed)).toBeNull();
  });
  it("rejects stale account decisions after password/verification changes without retaining credentials in evidence", async () => {
    await mockDatabase.user.update({ where: { id: seller.id }, data: { password: "private-updated-fixture-hash" } });
    await expect(mutateAccountAdministration(admin, { ...identity(seller), action: "seller-status", sellerStatus: "APPROVED" })).rejects.toMatchObject({ code: "ADMIN_TARGET_CHANGED" });
    const history = await readAccountAdministration(admin, { mode: "history", id: seller.id }); expect(history.events).toHaveLength(1); expect(JSON.stringify(history)).not.toContain("private-updated-fixture-hash");
    const current = await mockDatabase.user.findUniqueOrThrow({ where: { id: seller.id } }); await mockDatabase.user.update({ where: { id: seller.id }, data: { name: "Profile-only edit" } });
    expect((await mockDatabase.user.findUniqueOrThrow({ where: { id: seller.id } })).administrationVersion).toBe(current.administrationVersion);
  });
  it("paginates/searches accounts separately from seller members and recovers receipts outside filters", async () => {
    for (let n = 0; n < 22; n++) await mockDatabase.user.create({ data: { email: `literal_${n}_${randomUUID()}@accounts.example.invalid`, role: "USER" } });
    const first = await readAccountAdministration(admin, { q: "literal_", role: "USER" }), second = await readAccountAdministration(admin, { q: "literal_", role: "USER", page: 2 }); expect(first.total).toBe(22); expect(second.rows).toHaveLength(2);
    expect((await readAccountAdministration(admin, { scope: "members" })).rows.map((row) => row.id)).toEqual([seller.id]);
    expect((await readAccountAdministration(admin, { q: "%" })).rows).toHaveLength(0); expect((await readAccountAdministration(admin, { role: "ADMIN", sellerStatus: "PENDING" })).rows).toHaveLength(0);
    const input = { ...identity(seller), action: "seller-status", sellerStatus: "APPROVED" }; await mutateAccountAdministration(admin, input);
    const receipt = await readAccountAdministration(admin, { q: "absent", requestId: input.requestId }); expect(receipt.rows).toHaveLength(0); expect(receipt.attemptedRow?.id).toBe(seller.id);
  });
  it("enforces strict private handlers, owner, explicit affirmation, reason, body bounds and request limits", async () => {
    const api = await import("@/app/api/admin/accounts/route"), request = (query = "", body?: unknown, owner = admin.id) => new Request(`http://localhost/api/admin/accounts${query}`, { method: body ? "POST" : "GET", headers: { "X-Account-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await api.GET(request())).headers.get("cache-control")).toBe("private, no-store"); expect((await api.GET(request("", undefined, seller.id))).status).toBe(409); expect((await api.GET(request("?page=1&page=2"))).status).toBe(400);
    const valid = { ...identity(seller), action: "seller-status", sellerStatus: "APPROVED" };
    for (const changes of [{ confirmed: false }, { reason: "" }, { version: undefined }, { role: "ADMIN" }, { requestId: "reused" }]) expect((await api.POST(request("", { ...valid, ...changes }))).status).toBe(400);
    expect((await api.POST(request("", { padding: "x".repeat(8193) }))).status).toBe(413);
    const saved = await api.POST(request("", valid)); expect(saved.status).toBe(200); expect((await saved.json()).row.sellerStatus).toBe("APPROVED");
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); expect((await api.GET(request())).status).toBe(429);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(403);
  });
  it("hides a demoted seller catalog while retaining captured order, shipment and product history", async () => {
    await mutateAccountAdministration(admin, { ...identity(seller), action: "seller-status", sellerStatus: "APPROVED" });
    const current = await mockDatabase.user.findUniqueOrThrow({ where: { id: seller.id } });
    const category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } }), product = await mockDatabase.product.create({ data: { name: "Retained purchased product", slug: randomUUID(), sellerId: seller.id, categoryId: category.id, price: 100, stock: 10, status: "APPROVED" } });
    const order = await mockDatabase.order.create({ data: { userId: customer.id, total: 100, paymentMethod: "STRIPE", paymentStatus: "PAID", items: { create: [{ productId: product.id, quantity: 1, price: 100 }] } }, include: { items: true, fulfillments: true } });
    expect(await mockDatabase.product.count({ where: { ...publicProductWhere, id: product.id } })).toBe(1);
    await mutateAccountAdministration(admin, { ...identity(current), action: "role", role: "USER" });
    expect(await mockDatabase.product.count({ where: { ...publicProductWhere, id: product.id } })).toBe(0); expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, fulfillments: true } })).toEqual(order);
    const record = await readAccountAdministration(admin, { mode: "record", id: seller.id }); expect(record.rows[0]._count).toEqual({ products: 1, orders: 0, vendorFulfillments: 1 });
  });
});
