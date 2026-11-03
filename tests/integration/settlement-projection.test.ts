import type { PrismaClient, User, Product, Category } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { calculateSellerSettlement, type SettlementOrderInput, type SettlementShipmentInput } from "@/lib/settlement-policy";
import { mutateFulfillment, readSellerFulfillments } from "@/lib/fulfillments";
import { requestRefund, mutateRefundLocally } from "@/lib/refunds";
import { handleDisputeWebhook } from "@/lib/stripe/refunds";
import { refundProviderFixture } from "@/tests/helpers/refund-provider";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("exact settlement projection using actual purchase, refund and fulfillment rows", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, sellers: User[], buyer: User, category: Category, products: Product[], provider: ReturnType<typeof refundProviderFixture>;
  beforeAll(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    admin = await mockDatabase.user.create({ data: { email: `${randomUUID()}@settlement.example.invalid`, role: "ADMIN", isVerified: true } });
    sellers = await Promise.all([1, 2].map(() => mockDatabase.user.create({ data: { email: `${randomUUID()}@settlement.example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "APPROVED" } })));
    buyer = await mockDatabase.user.create({ data: { email: `${randomUUID()}@settlement.example.invalid`, role: "USER", isVerified: true } });
    category = await mockDatabase.category.create({ data: { name: "Settlement fixture", slug: randomUUID() } });
    products = await Promise.all(sellers.map((seller) => mockDatabase.product.create({ data: { name: "Purchased gadget", slug: randomUUID(), price: 100, stock: 50, sellerId: seller.id, categoryId: category.id } })));
    await mockDatabase.sellerSettlementPolicy.create({ data: { scopeKey: "GLOBAL", version: 1, commissionBps: 1010, shippingRecipient: "SELLER", createdById: admin.id, reason: "Actual configured commission and shipping rule" } });
    provider = refundProviderFixture(mockDatabase);
  }, 30_000);
  afterAll(async () => { provider?.restore(); await fixture?.close(); });
  beforeEach(async () => {
    for (const seller of sellers) { const prior = await mockDatabase.sellerSettlementPolicy.findFirst({ where: { scopeKey: `SELLER:${seller.id}` }, orderBy: { version: "desc" } }); if (prior?.commissionBps !== null && prior) await mockDatabase.sellerSettlementPolicy.create({ data: { scopeKey: prior.scopeKey, version: prior.version + 1, commissionBps: null, shippingRecipient: null, createdById: admin.id, reason: "Restore global inheritance for isolated scenario" } }); }
  });
  const create = (method = "COD", free = false, legacy = false) => mockDatabase.order.create({ data: { userId: buyer.id, total: free ? 15 : 195, paymentMethod: method, paymentStatus: method === "STRIPE" ? "PAID" : "UNPAID", status: "PROCESSING", ...(method === "STRIPE" ? { paymentIntentId: `pi_${randomUUID()}` } : {}), ...(!legacy ? { subtotalCents: BigInt(20000), discountCents: BigInt(free ? 20000 : 2000), shippingCents: BigInt(1500), pricingEvidence: "Verified settlement fixture purchase", pricingReconciledAt: new Date() } : {}), items: { create: products.map((product) => ({ productId: product.id, quantity: 1, price: 100, ...(!legacy ? { netCents: BigInt(free ? 0 : 9000) } : {}) })) } }, include: { items: true, fulfillments: true } });
  async function compare(id: string) {
    const order = await mockDatabase.order.findUniqueOrThrow({ where: { id }, include: { fulfillments: { include: { items: true } } } });
    const rows: SettlementShipmentInput[] = [];
    for (const fulfillment of [...order.fulfillments].sort((a, b) => a.id < b.id ? -1 : 1)) {
      const snapshot = await mockDatabase.sellerSettlementSnapshot.findUniqueOrThrow({ where: { fulfillmentId: fulfillment.id }, include: { policy: true } });
      rows.push({ id: fulfillment.id, sellerId: fulfillment.sellerId, status: fulfillment.status as SettlementShipmentInput["status"], codCollected: fulfillment.codCollected,
        grossCents: fulfillment.items.reduce((sum, item) => sum + BigInt(item.price.mul(item.quantity).mul(100).toFixed(0)), BigInt(0)),
        netCents: fulfillment.items.some((item) => item.netCents === null) ? null : fulfillment.items.reduce((sum, item) => sum + item.netCents!, BigInt(0)),
        retainedCents: fulfillment.items.some((item) => item.retainedCents === null) ? null : fulfillment.items.reduce((sum, item) => sum + item.retainedCents!, BigInt(0)),
        terms: snapshot.policy ? { commissionBps: snapshot.policy.commissionBps!, shippingRecipient: snapshot.policy.shippingRecipient as "SELLER" | "PLATFORM" } : null });
    }
    const expected = calculateSellerSettlement({ ...order, paymentMethod: order.paymentMethod as "COD" | "STRIPE", disputeStatus: order.disputeStatus as SettlementOrderInput["disputeStatus"], goodsCents: order.subtotalCents === null ? null : order.subtotalCents - order.discountCents! }, rows);
    const [actual] = await mockDatabase.$queryRaw<{ projection: unknown }[]>`SELECT seller_settlement_projection(${id}) AS projection`;
    expect(actual.projection).toEqual(JSON.parse(JSON.stringify(expected, (_key, value) => typeof value === "bigint" ? value.toString() : value))); return expected;
  }
  async function deliver(id: string, index: number) {
    const shipment = (await readSellerFulfillments(sellers[index], { orderId: id })).shipments[0];
    const sent = await mutateFulfillment(sellers[index], { action: "ship", fulfillmentId: shipment.id, version: shipment.version, carrier: "Actual courier", trackingNumber: `TRACK-${randomUUID()}` });
    return mutateFulfillment(admin, { action: "deliver", fulfillmentId: shipment.id, version: sent.shipment.version, codMoneyReceived: shipment.paymentMethod === "COD" });
  }
  it("matches SQL and TypeScript through actual per-seller COD delivery/collection and immutable future policy changes", async () => {
    const order = await create(); expect((await compare(order.id)).shipments.every((row) => row.availableCents === BigInt(0))).toBe(true);
    await deliver(order.id, 0); const partial = await compare(order.id); expect(partial.shipments.filter((row) => row.availableCents > BigInt(0))).toHaveLength(1); expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("UNPAID");
    await deliver(order.id, 1); expect((await compare(order.id)).shipments.every((row) => row.availableCents > BigInt(0))).toBe(true);
    const prior = await compare(order.id); await mockDatabase.sellerSettlementPolicy.create({ data: { scopeKey: `SELLER:${sellers[0].id}`, version: 1, commissionBps: 2500, shippingRecipient: "PLATFORM", createdById: admin.id, reason: "Changed future seller terms explicitly" } });
    expect(await compare(order.id)).toEqual(prior);
  });
  it("keeps partial refund holds and confirmed discounted refund values equal in SQL and TypeScript", async () => {
    const order = await create(); await deliver(order.id, 0); await deliver(order.id, 1);
    const before = await compare(order.id), current = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } });
    const requested = await requestRefund(admin, { orderId: order.id, version: current.refundVersion, requestId: randomUUID(), reason: "Confirmed customer refund request", selection: [{ itemId: order.items[0].id, quantity: 1 }] });
    expect((await compare(order.id)).shipments.every((row) => row.availableCents === BigInt(0) && row.holds.includes("REFUND_PENDING"))).toBe(true);
    const pending = await mockDatabase.refund.findUniqueOrThrow({ where: { id: requested.refund.id } });
    await mutateRefundLocally(admin, { action: "confirm-cod", refundId: pending.id, version: pending.version, method: "BANK", reference: `REF-${randomUUID()}`, moneyReturned: true });
    const after = await compare(order.id); expect(after.shipments.reduce((sum, row) => sum + row.availableCents, BigInt(0))).toBeLessThan(before.shipments.reduce((sum, row) => sum + row.availableCents, BigInt(0)));
  });
  it("handles fully discounted shipping, unknown legacy pricing and exact allocator values beyond float precision", async () => {
    const free = await create("COD", true); await deliver(free.id, 0); await deliver(free.id, 1); expect((await compare(free.id)).shipments.reduce((sum, row) => sum + row.availableCents, BigInt(0))).toBe(BigInt(1500));
    const legacy = await create("COD", false, true); expect((await compare(legacy.id)).shipments.every((row) => row.holds.includes("PRICING_REQUIRED"))).toBe(true);
    const [allocation] = await mockDatabase.$queryRaw<{ value: Record<string, string> }[]>`SELECT seller_settlement_allocate(900719925474099312345,'{"b":"1","a":"1","c":"1"}'::jsonb) AS value`;
    expect(Object.values(allocation.value).reduce((sum, value) => sum + BigInt(value), BigInt(0))).toBe(BigInt("900719925474099312345"));
  });
  it("matches real provider dispute holds and known losses without hiding excessive loss", async () => {
    const order = await create("STRIPE"); await deliver(order.id, 0); await deliver(order.id, 1);
    const dispute = { id: `dp_${randomUUID()}`, object: "dispute", payment_intent: order.paymentIntentId, amount: 3900, currency: "bdt", status: "needs_response" };
    provider.disputes.set(dispute.id, dispute as never); await handleDisputeWebhook(dispute as never); expect((await compare(order.id)).shipments.every((row) => row.holds.includes("DISPUTE_ACTIVE"))).toBe(true);
    provider.disputes.set(dispute.id, { ...dispute, status: "lost" } as never); await handleDisputeWebhook(dispute as never); const lost = await compare(order.id); expect(lost.shipments.reduce((sum, row) => sum + row.disputeLossCents, BigInt(0))).toBe(BigInt(3900));
  });
});
