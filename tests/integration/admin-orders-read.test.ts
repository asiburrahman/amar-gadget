import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readAdminOrders } from "@/lib/admin-orders-read";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { ServiceUnavailableError } from "@/lib/observability";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("bounded current-authority platform order reads", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, seller: User, buyer: User;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [admin, seller, buyer] = await Promise.all(["ADMIN", "MEMBER", "USER"].map((role, index) => mockDatabase.user.create({ data: { email: `${randomUUID()}@platform-orders.example.invalid`, name: index === 2 ? "Buyer 50%_safe" : "Other account", phone: index === 2 ? "+8801700000042" : null, role, sellerStatus: "APPROVED", isVerified: true } })));
    const category = await mockDatabase.category.create({ data: { name: "Order category", slug: randomUUID() } });
    const product = await mockDatabase.product.create({ data: { name: "Original purchased gadget", slug: randomUUID(), sellerId: seller.id, categoryId: category.id, price: 100, stock: 40, status: "APPROVED" } });
    for (let index = 0; index < 23; index++) await mockDatabase.order.create({ data: { userId: buyer.id, total: 100, status: index < 21 ? "PENDING" : index === 21 ? "DELIVERED" : "CANCELLED", paymentMethod: "STRIPE", paymentStatus: index === 21 ? "PAID" : "UNPAID", trackingNumber: index === 22 ? "TRACK_50%" : null, items: { create: { productId: product.id, quantity: 1, price: 100 } } } });
    await mockDatabase.product.update({ where: { id: product.id }, data: { name: "Renamed live product" } });
    await mockDatabase.order.create({ data: { userId: seller.id, total: 200, items: { create: { productId: product.id, quantity: 2, price: 100 } } } });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  it("covers every customer's orders in stable pages and keeps authoritative all-platform summaries", async () => {
    const first = await readAdminOrders(admin, {}), next = await readAdminOrders(admin, { page: 2 });
    expect(first).toMatchObject({ total: 24, totalPages: 2, summary: { orders: 24, pending: 22, delivered: 1, netFullyCollectedCents: 10000, partiallyCollectedCodOrders: 0 }, counts: { ALL: 24, PENDING: 22, DELIVERED: 1, CANCELLED: 1 } });
    expect(first.orders).toHaveLength(20); expect(next.orders).toHaveLength(4); expect(new Set([...first.orders, ...next.orders].map((order) => order.id)).size).toBe(24);
    expect(first.orders[0]).toHaveProperty("fulfillmentVersion"); expect(first.orders[0]).toHaveProperty("shippingCarrier"); expect(first.orders[0].user.email).toBeTruthy();
    expect(JSON.stringify(first)).not.toContain("refundedCents");
  });
  it("searches all customers, phone, literal metacharacters, tracking and captured labels before pagination", async () => {
    const original = await readAdminOrders(admin, { q: "Original purchased", status: "PENDING", page: 2 }); expect(original.total).toBe(21); expect(original.orders).toHaveLength(1);
    expect(original.orders[0].items[0].product.name).toBe("Original purchased gadget"); expect(original.summary.orders).toBe(24);
    expect((await readAdminOrders(admin, { q: "RENAMED LIVE" })).total).toBe(1);
    expect((await readAdminOrders(admin, { q: "%_" })).total).toBe(23);
    expect((await readAdminOrders(admin, { q: "+8801700000042" })).total).toBe(23);
    expect((await readAdminOrders(admin, { q: buyer.email })).total).toBe(23);
    const tracked = await readAdminOrders(admin, { q: "TRACK_50%" }); expect(tracked.total).toBe(1);
    expect((await readAdminOrders(admin, { q: tracked.orders[0].id.slice(0, 12) })).total).toBe(1);
  });
  it("distinguishes invalid/out-of-range requests and genuine empty filters without losing whole-market totals", async () => {
    await expect(readAdminOrders(admin, { page: 3 })).rejects.toBeInstanceOf(ReadPageError);
    await expect(readAdminOrders(admin, { status: "forged" })).rejects.toThrow(); await expect(readAdminOrders(admin, { userId: buyer.id })).rejects.toThrow();
    expect(await readAdminOrders(admin, { q: "absent item" })).toMatchObject({ total: 0, totalPages: 1, orders: [], summary: { orders: 24 } });
  });
  it("rejects other roles, demoted administrators and stale sessions", async () => {
    await expect(readAdminOrders(seller, {})).rejects.toBeInstanceOf(ReadAccessError); await expect(readAdminOrders(buyer, {})).rejects.toBeInstanceOf(ReadAccessError);
    await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "USER" } }); await expect(readAdminOrders(admin, {})).rejects.toBeInstanceOf(ReadAccessError);
    const restored = await mockDatabase.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } }); await expect(readAdminOrders(admin, {})).rejects.toBeInstanceOf(ReadAccessError); expect((await readAdminOrders(restored, {})).total).toBe(24);
  });
  it("reports a correlated sanitized incident for an actual missing table instead of an empty platform", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mockDatabase.$executeRawUnsafe('ALTER TABLE "Order" RENAME TO "FixtureUnavailableOrder"');
      let caught: unknown; try { await readAdminOrders(admin, {}); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ServiceUnavailableError); expect((caught as ServiceUnavailableError).incident.operation).toBe("admin.orders");
      expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe((caught as ServiceUnavailableError).digest); expect(JSON.stringify(log.mock.calls)).not.toContain("FixtureUnavailableOrder");
    } finally { await mockDatabase.$executeRawUnsafe('ALTER TABLE "FixtureUnavailableOrder" RENAME TO "Order"'); log.mockRestore(); }
  });
});
