import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readCustomerOrders } from "@/lib/customer-orders-read";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { ServiceUnavailableError } from "@/lib/observability";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("bounded own-account order history", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, buyer: User, other: User;
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [buyer, other] = await Promise.all(["USER", "MEMBER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@orders-read.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    const category = await mockDatabase.category.create({ data: { name: "History category", slug: randomUUID() } });
    const product = await mockDatabase.product.create({ data: { name: "Purchased gadget", slug: "original-gadget", categoryId: category.id, sellerId: other.id, price: 100, stock: 40, status: "APPROVED" } });
    for (let index = 0; index < 23; index++) {
      if (index === 21 || index === 22) await mockDatabase.product.update({ where: { id: product.id }, data: { name: index === 21 ? "Original 50%_safe label" : "Purchased gadget" } });
      await mockDatabase.order.create({ data: {
      userId: buyer.id, total: 100, status: index < 21 ? "PENDING" : index === 21 ? "DELIVERED" : "CANCELLED",
      trackingNumber: index === 22 ? "TRACK_50%" : null,
      items: { create: { productId: product.id, quantity: 1, price: 100, productName: index === 21 ? "Original 50%_safe label" : "Purchased gadget", productSlug: "original-gadget" } },
      } });
    }
    await mockDatabase.product.update({ where: { id: product.id }, data: { name: "Other buyer private item" } });
    await mockDatabase.order.create({ data: { userId: other.id, total: 200, items: { create: { productId: product.id, quantity: 2, price: 100, productName: "Other buyer private item" } } } });
    await mockDatabase.product.update({ where: { id: product.id }, data: { name: "Renamed live product", slug: "renamed-live-product" } });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });

  it("pages all owned orders deterministically, with whole-history counts and original detail fields", async () => {
    const first = await readCustomerOrders(buyer, {}), second = await readCustomerOrders(buyer, { page: 2 });
    expect(first).toMatchObject({ total: 23, totalPages: 2, pageSize: 20, counts: { ALL: 23, ACTIVE: 21, DELIVERED: 1, CANCELLED: 1 } });
    expect(first.orders).toHaveLength(20); expect(second.orders).toHaveLength(3);
    expect(new Set([...first.orders, ...second.orders].map((order) => order.id)).size).toBe(23);
    expect(first.orders.every((order) => order.userId === buyer.id)).toBe(true);
    expect(first.orders[0]).toHaveProperty("refundedCents"); expect(first.orders[0]).toHaveProperty("fulfillments");
    expect(first.orders[0].items[0]).toHaveProperty("productSlug", "original-gadget");
    expect(first.user).toEqual({ id: buyer.id, email: buyer.email, name: buyer.name });
    expect((await readCustomerOrders(other, {})).total).toBe(1);
  });
  it("searches immutable purchase labels and literal tracking text across the complete history", async () => {
    const literal = await readCustomerOrders(buyer, { q: "%_", status: "DELIVERED" });
    expect(literal.total).toBe(1); expect(literal.orders[0].items[0].productName).toBe("Original 50%_safe label");
    expect((await readCustomerOrders(buyer, { q: "RENAMED LIVE" })).total).toBe(0);
    expect((await readCustomerOrders(buyer, { q: "TRACK_50%" })).total).toBe(1);
    expect((await readCustomerOrders(buyer, { q: literal.orders[0].id.slice(0, 12) })).total).toBe(1);
    expect((await readCustomerOrders(buyer, { q: "Other buyer private" })).total).toBe(0);
    const active = await readCustomerOrders(buyer, { q: "Purchased", status: "ACTIVE", page: 2 });
    expect(active).toMatchObject({ total: 21, counts: { ALL: 22, ACTIVE: 21, DELIVERED: 0, CANCELLED: 1 } }); expect(active.orders).toHaveLength(1);
  });
  it("distinguishes invalid and expired pages from a genuine empty search", async () => {
    await expect(readCustomerOrders(buyer, { page: 3 })).rejects.toBeInstanceOf(ReadPageError);
    await expect(readCustomerOrders(buyer, { page: 0 })).rejects.toThrow();
    await expect(readCustomerOrders(buyer, { userId: other.id })).rejects.toThrow();
    expect(await readCustomerOrders(buyer, { q: "absent order" })).toMatchObject({ total: 0, totalPages: 1, orders: [] });
  });
  it("refuses revoked sessions and unverified accounts instead of returning stale private data", async () => {
    const current = await mockDatabase.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(readCustomerOrders(buyer, {})).rejects.toBeInstanceOf(ReadAccessError);
    expect((await readCustomerOrders(current, {})).total).toBe(23);
    await mockDatabase.user.update({ where: { id: buyer.id }, data: { isVerified: false } });
    await expect(readCustomerOrders(current, {})).rejects.toBeInstanceOf(ReadAccessError);
  });
  it("does not turn an actual database failure into an empty order history", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await mockDatabase.$executeRawUnsafe('ALTER TABLE "Order" RENAME TO "FixtureUnavailableOrder"');
      let caught: unknown; try { await readCustomerOrders(buyer, {}); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ServiceUnavailableError);
      expect((caught as ServiceUnavailableError).incident.operation).toBe("customer.orders");
      expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe((caught as ServiceUnavailableError).digest);
      expect(JSON.stringify(log.mock.calls)).not.toContain("FixtureUnavailableOrder");
    } finally { await mockDatabase.$executeRawUnsafe('ALTER TABLE "FixtureUnavailableOrder" RENAME TO "Order"'); log.mockRestore(); }
  });
});
