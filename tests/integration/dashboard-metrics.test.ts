import type { PrismaClient, User, Product } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { DashboardAccessError, readCustomerDashboard, readSellerDashboardMetrics, dashboardYear } from "@/lib/dashboard-metrics";
import { mutateFulfillment, readSellerFulfillments } from "@/lib/fulfillments";
import { requestRefund, mutateRefundLocally } from "@/lib/refunds";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("all-time and month-cohort dashboards with actual PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, buyer: User, seller: User, other: User, admin: User, products: Product[];
  beforeAll(async () => { fixture = await createFinanceDatabase(); mockDatabase = fixture.db; }, 30_000);
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    [buyer, seller, other, admin] = await Promise.all(["USER", "MEMBER", "MEMBER", "ADMIN"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@dashboard.example.invalid`, role, sellerStatus: "APPROVED", isVerified: true } })));
    const category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } });
    products = await Promise.all([seller, seller, other].map((owner) => mockDatabase.product.create({ data: { name: randomUUID(), slug: randomUUID(), categoryId: category.id, sellerId: owner.id, price: 100, stock: 100, status: "APPROVED" } })));
  });
  const order = (options: { method?: string; status?: string; paid?: boolean; date?: string; lines?: number[]; legacy?: boolean } = {}) => {
    const lines = options.lines ?? [0], method = options.method ?? "STRIPE";
    return mockDatabase.order.create({ data: { userId: buyer.id, total: lines.length * 90 + 10, paymentMethod: method, paymentStatus: (options.paid ?? method === "STRIPE") ? "PAID" : "UNPAID", status: options.status ?? "PROCESSING", createdAt: new Date(options.date ?? "2026-06-01T00:00:00Z"), ...(!options.legacy ? { subtotalCents: BigInt(lines.length * 10000), discountCents: BigInt(lines.length * 1000), shippingCents: BigInt(1000), pricingEvidence: "Recorded discount and original shipping", pricingReconciledAt: new Date() } : {}), items: { create: lines.map((index) => ({ productId: products[index].id, quantity: 1, price: 100, ...(!options.legacy ? { netCents: BigInt(9000) } : {}) })) } }, include: { items: true, fulfillments: true } });
  };
  const deliver = async (id: string, owner = seller) => {
    let group = (await readSellerFulfillments(owner, { orderId: id })).shipments[0];
    group = (await mutateFulfillment(owner, { action: "ship", fulfillmentId: group.id, version: group.version, carrier: "Real test courier", trackingNumber: `ACTUAL-${group.id}` })).shipment;
    await mutateFulfillment(admin, { action: "deliver", fulfillmentId: group.id, version: group.version, codMoneyReceived: group.paymentMethod === "COD" });
  };
  it("counts every customer order beyond the recent ten and separates paid, delivered, cancelled and unpaid money", async () => {
    for (let i = 0; i < 12; i++) await order({ paid: false, status: "PENDING" });
    const delivered = await order(); await deliver(delivered.id);
    await order({ paid: false, status: "CANCELLED" }); await order({ status: "CANCELLED" }); // A late capture is actual paid money, not delivered spend.
    const result = await readCustomerDashboard(buyer);
    expect(result.metrics).toEqual({ totalOrders: 15, activeOrders: 12, netPaidCents: 20000, deliveredPaidCents: 10000, reviewOrders: 0, partiallyCollectedCodOrders: 0 });
    expect(result.recent).toHaveLength(10); expect(result.recent.every((row) => !Object.hasOwn(row, "userId") && !Object.hasOwn(row, "shippingAddress"))).toBe(true);
    expect((await readCustomerDashboard(other)).metrics.totalOrders).toBe(0);
  });
  it("counts seller orders once for multiple lines, ignores unpaid/cancelled value and preserves captured ownership", async () => {
    const paid = await order({ lines: [0, 1, 2] }); await deliver(paid.id);
    await order({ lines: [0, 1], paid: false }); await order({ status: "CANCELLED" });
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { sellerId: other.id, price: 9999 } });
    const result = await readSellerDashboardMetrics(seller, 2026);
    expect(result).toMatchObject({ totalOrders: 3, pendingOrders: 1, paidItemCents: 18000, deliveredItemCents: 18000, deliveredUnits: 2, excludedLines: 0 });
    expect(result.monthly).toEqual([expect.objectContaining({ month: "2026-06", ordersCount: 3, paidItemCents: 18000, deliveredItemCents: 18000 })]);
    expect(await readSellerDashboardMetrics(other, 2026)).toMatchObject({ totalOrders: 1, paidItemCents: 9000, deliveredItemCents: 0 });
  });
  it("uses actual collected COD shipments and warns customers until their complete order is paid", async () => {
    const cod = await order({ method: "COD", lines: [0, 1, 2] }); await deliver(cod.id);
    expect((await readCustomerDashboard(buyer)).metrics).toMatchObject({ activeOrders: 1, netPaidCents: 0, deliveredPaidCents: 0, partiallyCollectedCodOrders: 1 });
    expect(await readSellerDashboardMetrics(seller, 2026)).toMatchObject({ totalOrders: 1, deliveredItemCents: 18000, deliveredUnits: 2, pendingOrders: 0 });
    expect(await readSellerDashboardMetrics(other, 2026)).toMatchObject({ totalOrders: 1, paidItemCents: 0, deliveredItemCents: 0, pendingOrders: 1 });
    await deliver(cod.id, other);
    expect((await readCustomerDashboard(buyer)).metrics).toMatchObject({ activeOrders: 0, netPaidCents: 28000, deliveredPaidCents: 28000, partiallyCollectedCodOrders: 0 });
  });
  it("deducts actual quantity refunds and preserves non-refundable delivered shipping", async () => {
    const cod = await order({ method: "COD", lines: [0, 1] }); await deliver(cod.id);
    const initial = await mockDatabase.order.findUniqueOrThrow({ where: { id: cod.id } });
    const refund = await requestRefund(admin, { orderId: cod.id, version: initial.refundVersion, requestId: randomUUID(), reason: "Confirmed actual customer reimbursement", selection: [{ itemId: cod.items[0].id, quantity: 1 }] });
    await mutateRefundLocally(admin, { action: "confirm-cod", refundId: refund.refund.id, version: refund.refund.version, moneyReturned: true, method: "BANK", reference: randomUUID() });
    expect((await readCustomerDashboard(buyer)).metrics).toMatchObject({ totalOrders: 1, netPaidCents: 10000, deliveredPaidCents: 10000 });
    expect(await readSellerDashboardMetrics(seller, 2026)).toMatchObject({ totalOrders: 1, deliveredItemCents: 9000, deliveredUnits: 1 });
  });
  it("excludes legacy unknown values and held/disputed attribution without inventing seller earnings", async () => {
    const legacy = await order({ legacy: true }); await deliver(legacy.id);
    const held = await order(); await deliver(held.id);
    await mockDatabase.order.update({ where: { id: held.id }, data: { disputeStatus: "LOST", disputeAmountCents: BigInt(2500) } });
    expect(await readSellerDashboardMetrics(seller, 2026)).toMatchObject({ totalOrders: 2, paidItemCents: 0, deliveredItemCents: 0, excludedLines: 2 });
    expect((await readCustomerDashboard(buyer)).metrics).toMatchObject({ netPaidCents: 17500, deliveredPaidCents: 17500, reviewOrders: 1 });
  });
  it("groups placement cohorts across the Dhaka month boundary with exactly one row per month", async () => {
    await order({ date: "2026-01-31T17:59:59Z", lines: [0, 1] });
    await order({ date: "2026-01-31T18:00:00Z", lines: [0, 1] });
    await order({ date: "2025-12-01T00:00:00Z" });
    const result = await readSellerDashboardMetrics(seller, 2026);
    expect(result).toMatchObject({ totalOrders: 3, firstYear: 2025, paidItemCents: 45000 });
    expect(result.monthly.map((row) => [row.month, row.ordersCount, row.paidItemCents])).toEqual([["2026-02", 1, 18000], ["2026-01", 1, 18000]]);
    expect((await readSellerDashboardMetrics(seller, 2025)).monthly[0]).toMatchObject({ month: "2025-12", ordersCount: 1, paidItemCents: 9000 });
  });
  it("reads counts and recent orders in one stable database snapshot during a concurrent new purchase", async () => {
    await order(); let reached!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => { reached = resolve; }), resume = new Promise<void>((resolve) => { release = resolve; });
    const original = mockDatabase;
    mockDatabase = fixture.db.$extends({ query: { order: { async findMany({ args, query }) { reached(); await resume; return query(args); } } } }) as unknown as PrismaClient;
    try {
      const work = readCustomerDashboard(buyer); await reading; await order(); release();
      const result = await work; expect(result.metrics.totalOrders).toBe(1); expect(result.recent).toHaveLength(1);
      expect((await readCustomerDashboard(buyer)).metrics.totalOrders).toBe(2);
    } finally { release(); mockDatabase = original; }
  });
  it("rejects stale, mismatched, unverified and unapproved authority before reading metrics", async () => {
    await expect(readSellerDashboardMetrics(buyer, 2026)).rejects.toBeInstanceOf(DashboardAccessError);
    await mockDatabase.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); await expect(readSellerDashboardMetrics(seller, 2026)).rejects.toBeInstanceOf(DashboardAccessError);
    await mockDatabase.user.update({ where: { id: buyer.id }, data: { sessionVersion: { increment: 1 } } }); await expect(readCustomerDashboard(buyer)).rejects.toBeInstanceOf(DashboardAccessError);
    await mockDatabase.user.update({ where: { id: other.id }, data: { isVerified: false } }); await expect(readCustomerDashboard(other)).rejects.toBeInstanceOf(DashboardAccessError);
  });
  it("validates bounded year input using the application timezone", () => {
    expect(dashboardYear(undefined, new Date("2026-12-31T18:00:00Z"))).toBe(2027);
    for (const input of [["2026", "2025"], "NaN", "2026.0", "1999", "9999", "2026 OR true"]) expect(dashboardYear(input)).toBeNull();
  });
});
