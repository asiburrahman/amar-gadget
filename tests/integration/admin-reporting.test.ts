import type { PrismaClient, User, Product } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { readAdministratorReport, readAdministratorOverview, administratorReportCsv } from "@/lib/admin-reporting";
import { mutateFulfillment, readSellerFulfillments } from "@/lib/fulfillments";
import { requestRefund, mutateRefundLocally } from "@/lib/refunds";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("administrator cohort reports with actual PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, buyer: User, admin: User, seller: User, other: User, products: Product[];
  beforeEach(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [buyer, admin, seller, other] = await Promise.all(["USER", "ADMIN", "MEMBER", "MEMBER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@report.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    const category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } });
    products = await Promise.all([seller, other].map((owner) => mockDatabase.product.create({ data: { name: randomUUID(), slug: randomUUID(), price: 100, stock: 100, sellerId: owner.id, categoryId: category.id, status: "APPROVED" } })));
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
  }, 30_000);
  afterEach(async () => { await fixture?.close(); });
  const order = (options: { date?: string; method?: string; paid?: boolean; lines?: number[]; id?: string; status?: string } = {}) => {
    const lines = options.lines ?? [0], method = options.method ?? "STRIPE";
    return mockDatabase.order.create({ data: { ...(options.id ? { id: options.id } : {}), userId: buyer.id, total: lines.length * 90 + 10, status: options.status ?? "PROCESSING", paymentMethod: method, paymentStatus: (options.paid ?? method === "STRIPE") ? "PAID" : "UNPAID", createdAt: new Date(options.date ?? "2026-11-02T00:00:00Z"), subtotalCents: BigInt(lines.length * 10000), discountCents: BigInt(lines.length * 1000), shippingCents: BigInt(1000), pricingEvidence: "Recorded original shipping and item discount", pricingReconciledAt: new Date(), items: { create: lines.map((index) => ({ productId: products[index].id, quantity: 1, price: 100, netCents: BigInt(9000) })) } }, include: { items: true } });
  };
  const filters = { from: "2026-11-02", to: "2026-11-02" };
  const deliver = async (orderId: string, owner = seller) => {
    let group = (await readSellerFulfillments(owner, { orderId })).shipments[0]; group = (await mutateFulfillment(owner, { action: "ship", fulfillmentId: group.id, version: group.version, carrier: "Test courier", trackingNumber: randomUUID() })).shipment;
    await mutateFulfillment(admin, { action: "deliver", fulfillmentId: group.id, version: group.version, codMoneyReceived: group.paymentMethod === "COD" });
  };
  it("uses inclusive Dhaka calendar dates, stable pagination and daily cohorts with actual overview counts", async () => {
    await order({ date: "2026-11-01T17:59:59.999Z" }); await order({ date: "2026-11-01T18:00:00.000Z" }); await order({ date: "2026-11-02T17:59:59.999Z" }); await order({ date: "2026-11-02T18:00:00.000Z" });
    const report = await readAdministratorReport(admin, filters); expect(report.summary).toMatchObject({ orders: 2, grossOrderCents: 20000, paidCaptureCents: 20000, netFullyCollectedCents: 20000 }); expect(report.daily).toEqual([expect.objectContaining({ day: "2026-11-02", orders: 2 })]);
    const overview = await readAdministratorOverview(admin); expect(overview).toMatchObject({ users: 4, customers: 1, sellers: 2, administrators: 1, products: 2, pendingProducts: 0, orders: 4, paidRevenueCents: 40000 });
    for (let index = 0; index < 22; index++) await order({ paid: false });
    const a = await readAdministratorReport(admin, filters), b = await readAdministratorReport(admin, { ...filters, page: 2 }); expect(a.rows).toHaveLength(20); expect(b.rows).toHaveLength(4); expect(new Set([...a.rows, ...b.rows].map((row) => row.id)).size).toBe(24);
    expect((await readAdministratorReport(admin, { ...filters, paymentStatus: "PAID" })).summary.orders).toBe(2);
  });
  it("deducts actual confirmed refunds and lost disputes while identifying partially collected COD orders", async () => {
    const cod = await order({ method: "COD" }); await deliver(cod.id);
    const recorded = await mockDatabase.order.findUniqueOrThrow({ where: { id: cod.id } }), refund = await requestRefund(admin, { orderId: cod.id, version: recorded.refundVersion, requestId: randomUUID(), reason: "Actual customer repayment after delivery", selection: [{ itemId: cod.items[0].id, quantity: 1 }] });
    await mutateRefundLocally(admin, { action: "confirm-cod", refundId: refund.refund.id, version: refund.refund.version, moneyReturned: true, method: "BANK", reference: randomUUID() });
    const disputed = await order(); await mockDatabase.order.update({ where: { id: disputed.id }, data: { disputeStatus: "LOST", disputeAmountCents: BigInt(2500) } });
    await order({ paid: false }); const partial = await order({ method: "COD", lines: [0, 1] }); await deliver(partial.id);
    const report = await readAdministratorReport(admin, filters); expect(report.summary).toEqual({ orders: 4, grossOrderCents: 49000, paidCaptureCents: 20000, paidRefundCents: 9000, lostDisputeCents: 2500, netFullyCollectedCents: 8500, partiallyCollectedCodOrders: 1, reviewOrders: 1 });
    expect(report.rows.find((row) => row.id === cod.id)).toMatchObject({ refundedCents: 9000, netCents: 1000 }); expect(report.rows.find((row) => row.id === partial.id)).toMatchObject({ netCents: null, collectedShipments: 1 });
    expect((await readAdministratorReport(admin, { ...filters, paymentMethod: "COD", paymentStatus: "PAID", status: "DELIVERED" })).rows.map((row) => row.id)).toEqual([cod.id]);
  });
  it("keeps aggregate, rows and daily values in one snapshot during a concurrent new order", async () => {
    await order(); let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => { reached = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const original = mockDatabase;
    mockDatabase = fixture.db.$extends({ query: { async $queryRaw({ args, query }) {
      const sql = args as unknown as { strings?: readonly string[] };
      if (sql.strings?.join("").includes('SELECT o.id,o."userId"')) { reached(); await gate; }
      return query(args);
    } } }) as unknown as PrismaClient;
    let pending: ReturnType<typeof readAdministratorReport> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      pending = readAdministratorReport(admin, filters);
      await Promise.race([ready, pending.then(() => { throw new Error("The report finished before the actual row-query barrier"); }), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("The actual row-query barrier was not reached")), 3000); })]);
      await order(); release(); const report = await pending; expect(report.summary.orders).toBe(1); expect(report.rows).toHaveLength(1); expect(report.daily[0].orders).toBe(1);
    } finally { if (deadline) clearTimeout(deadline); release(); await pending?.catch(() => undefined); mockDatabase = original; }
    expect((await readAdministratorReport(admin, filters)).summary.orders).toBe(2);
  });
  it("exports the complete filtered cohort with exact money, formula-safe cells and no private addresses", async () => {
    const created = await order({ id: "=SUM(1,1)" });
    const report = await readAdministratorReport(admin, { ...filters, format: "csv" }), csv = administratorReportCsv(report);
    expect(csv).toContain(`"'=SUM(1,1)"`); expect(csv).toContain('"100.00"'); expect(csv).toContain('"0.00"'); expect(csv).not.toContain("shippingPhone"); expect(csv).not.toContain(buyer.email); expect(report.rows[0].id).toBe(created.id);
    const empty = await readAdministratorReport(admin, { ...filters, paymentStatus: "UNPAID", format: "csv" }); expect(empty.rows).toHaveLength(0); expect(administratorReportCsv(empty).split("\r\n")).toHaveLength(2);
  });
  it("refuses oversized exports without silently truncating financial evidence", async () => {
    await mockDatabase.$executeRaw`INSERT INTO "Order"(id,"userId",total,"createdAt","updatedAt") SELECT gen_random_uuid()::text,${buyer.id},1,'2026-11-02 00:00:00'::timestamp,timezone('UTC',CURRENT_TIMESTAMP) FROM generate_series(1,5001)`;
    await expect(readAdministratorReport(admin, { ...filters, format: "csv" })).rejects.toMatchObject({ code: "ADMIN_EXPORT_LIMIT" });
    expect((await readAdministratorReport(admin, filters)).summary.orders).toBe(5001);
  }, 30_000);
  it("enforces private route filters, owner, real authority, CSV headers and limits", async () => {
    await order(); const api = await import("@/app/api/admin/reports/route"), request = (query: string, owner = admin.id) => new Request(`http://localhost/api/admin/reports?${query}`, { headers: { "X-Reports-Owner": owner } });
    expect((await api.GET(request("from=2026-11-02&to=2026-11-02&format=csv"))).headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const json = await api.GET(request("from=2026-11-02&to=2026-11-02")); expect(json.headers.get("cache-control")).toBe("private, no-store"); expect(json.status).toBe(200);
    for (const query of ["from=2026-02-30&to=2026-03-01", "from=2020-01-01&to=2026-11-02", "from=2026-11-02", "page=1&page=2", "role=ADMIN"]) expect((await api.GET(request(query))).status).toBe(400);
    expect((await api.GET(request("", buyer.id))).status).toBe(409); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request(""))).status).toBe(403); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); expect((await api.GET(request(""))).status).toBe(429);
    await mockDatabase.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } }); await expect(readAdministratorReport(admin, filters)).rejects.toMatchObject({ status: 403 });
  });
});
