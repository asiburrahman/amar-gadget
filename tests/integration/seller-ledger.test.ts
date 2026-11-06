import type { PrismaClient, User, Product, Category } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { mutateFulfillment, readSellerFulfillments } from "@/lib/fulfillments";
import { requestRefund, mutateRefundLocally } from "@/lib/refunds";
import { handleDisputeWebhook } from "@/lib/stripe/refunds";
import { refundProviderFixture } from "@/tests/helpers/refund-provider";
import { mutateSellerSettlement, readSellerSettlement } from "@/lib/seller-settlement";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("transactional seller ledger and externally confirmed payout reservation", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, seller: User, buyer: User, category: Category, product: Product, provider: ReturnType<typeof refundProviderFixture>;
  beforeAll(async () => { fixture = await createFinanceDatabase(); mockDatabase = fixture.db; provider = refundProviderFixture(mockDatabase); }, 30_000);
  afterAll(async () => { provider?.restore(); await fixture?.close(); });
  beforeEach(async () => {
    jest.clearAllMocks(); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    [admin, seller, buyer] = await Promise.all(["ADMIN", "MEMBER", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@ledger.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    category = await mockDatabase.category.create({ data: { name: `Ledger fixture ${randomUUID()}`, slug: randomUUID() } }); product = await mockDatabase.product.create({ data: { name: "Purchased ledger gadget", slug: randomUUID(), price: 100, stock: 100, sellerId: seller.id, categoryId: category.id } });
    await mockDatabase.sellerSettlementPolicy.create({ data: { scopeKey: `SELLER:${seller.id}`, version: 1, commissionBps: 1000, shippingRecipient: "SELLER", createdById: admin.id, reason: "Actual reviewed seller commercial terms" } });
  });
  const create = (method = "COD") => mockDatabase.order.create({ data: { userId: buyer.id, total: 115, paymentMethod: method, paymentStatus: method === "STRIPE" ? "PAID" : "UNPAID", status: "PROCESSING", ...(method === "STRIPE" ? { paymentIntentId: `pi_${randomUUID()}` } : {}), subtotalCents: BigInt(10000), discountCents: BigInt(0), shippingCents: BigInt(1500), pricingEvidence: "Actual isolated purchase quote", pricingReconciledAt: new Date(), items: { create: [{ productId: product.id, quantity: 1, price: 100, netCents: BigInt(10000) }] } }, include: { items: true, fulfillments: true } });
  const wallet = async () => (await mockDatabase.sellerWallet.findUniqueOrThrow({ where: { sellerId: seller.id } })).balanceCents;
  async function deliver(id: string) { const shipment = (await readSellerFulfillments(seller, { orderId: id })).shipments[0]; const sent = await mutateFulfillment(seller, { action: "ship", fulfillmentId: shipment.id, version: shipment.version, carrier: "Actual courier", trackingNumber: `TRACK-${randomUUID()}` }); await mutateFulfillment(admin, { action: "deliver", fulfillmentId: shipment.id, version: sent.shipment.version, codMoneyReceived: shipment.paymentMethod === "COD" }); }
  const reserve = (amount = BigInt(10000), method = "BANK") => mockDatabase.sellerPayout.create({ data: { sellerId: seller.id, amountCents: amount, method, createdById: admin.id, reason: "Reviewed available seller payout" } });
  it("posts availability at delivery/collection commit and does not duplicate credits on repeated reconciliation", async () => {
    const order = await create(); expect(await wallet()).toBe(BigInt(0)); await deliver(order.id); expect(await wallet()).toBe(BigInt(10500));
    await mockDatabase.$executeRaw`SELECT reconcile_seller_order(${order.id})`; await mockDatabase.$executeRaw`SELECT reconcile_seller_order(${order.id})`;
    expect(await wallet()).toBe(BigInt(10500)); expect(await mockDatabase.sellerLedgerEntry.count({ where: { sellerId: seller.id } })).toBe(1);
    const source = await mockDatabase.sellerAccrual.findUniqueOrThrow({ where: { fulfillmentId: order.fulfillments[0].id } }); expect(source.targetCents).toBe(BigInt(10500));
    await expect(mockDatabase.sellerWallet.update({ where: { sellerId: seller.id }, data: { balanceCents: BigInt(999999) } })).rejects.toThrow(); expect(await wallet()).toBe(BigInt(10500));
  });
  it("serializes competing reservations and releases a cancelled untransferred payout exactly once", async () => {
    const order = await create(); await deliver(order.id);
    const attempts = await Promise.allSettled([reserve(), reserve()]); expect(attempts.filter((row) => row.status === "fulfilled")).toHaveLength(1); expect(await wallet()).toBe(BigInt(500));
    const payout = await mockDatabase.sellerPayout.findFirstOrThrow({ where: { sellerId: seller.id } });
    await expect(mockDatabase.sellerPayout.update({ where: { id: payout.id }, data: { status: "CANCELLED", version: 2, resolvedById: admin.id, resolutionReason: "No payment was sent externally" } })).rejects.toThrow();
    await mockDatabase.sellerPayout.update({ where: { id: payout.id }, data: { status: "CANCELLED", version: 2, resolvedById: admin.id, resolutionReason: "No payment was sent externally", moneyNotSent: true } }); expect(await wallet()).toBe(BigInt(10500));
    await expect(mockDatabase.sellerPayout.update({ where: { id: payout.id }, data: { version: 3, status: "PAID", reference: "LATE-PAYMENT" } })).rejects.toThrow(); expect(await mockDatabase.sellerPayoutEvent.count({ where: { payoutId: payout.id } })).toBe(2);
  });
  it("records external payment once, normalizes duplicate references and retains intent/evidence", async () => {
    const order = await create(); await deliver(order.id); const first = await reserve(BigInt(5000), "bank"); expect(first.method).toBe("BANK"); expect(await wallet()).toBe(BigInt(5500));
    await expect(mockDatabase.sellerPayout.update({ where: { id: first.id }, data: { status: "PAID", version: 2, resolvedById: admin.id, resolutionReason: "Actual bank transfer confirmed" } })).rejects.toThrow();
    await mockDatabase.sellerPayout.update({ where: { id: first.id }, data: { status: "PAID", version: 2, resolvedById: admin.id, resolutionReason: "Actual bank transfer confirmed", reference: " BANK-123 " } }); expect(await wallet()).toBe(BigInt(5500));
    const next = await reserve(BigInt(1000)); await expect(mockDatabase.sellerPayout.update({ where: { id: next.id }, data: { status: "PAID", version: 2, resolvedById: admin.id, resolutionReason: "Duplicate external reference cannot confirm twice", reference: "bank-123" } })).rejects.toThrow();
    await expect(mockDatabase.sellerPayout.delete({ where: { id: first.id } })).rejects.toThrow(); await expect(mockDatabase.sellerLedgerEntry.deleteMany({ where: { sellerId: seller.id } })).rejects.toThrow(); await expect(mockDatabase.order.delete({ where: { id: order.id } })).rejects.toThrow();
  });
  it("withdraws availability during refund and records debt after an already completed external payout", async () => {
    const order = await create(); await deliver(order.id); const payout = await reserve(BigInt(10500));
    await mockDatabase.sellerPayout.update({ where: { id: payout.id }, data: { status: "PAID", version: 2, resolvedById: admin.id, resolutionReason: "External payout actually sent", reference: randomUUID() } }); expect(await wallet()).toBe(BigInt(0));
    const current = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } }), pending = await requestRefund(admin, { orderId: order.id, version: current.refundVersion, requestId: randomUUID(), reason: "Actual customer return reimbursement", selection: "FULL" });
    expect(await wallet()).toBe(BigInt(-10500)); const refund = await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } });
    await mutateRefundLocally(admin, { action: "confirm-cod", refundId: refund.id, version: refund.version, moneyReturned: true, method: "BANK", reference: randomUUID() }); expect(await wallet()).toBe(BigInt(-9000));
    await expect(reserve(BigInt(1))).rejects.toThrow(); const earnings = await create(); await deliver(earnings.id); expect(await wallet()).toBe(BigInt(1500));
    const [balance] = await mockDatabase.$queryRaw<{ amount: string }[]>`SELECT sum("deltaCents")::text AS amount FROM "SellerLedgerEntry" WHERE "sellerId"=${seller.id}`; expect(balance.amount).toBe("1500");
  });
  it("holds active provider disputes and posts actual partial loss with commission reversal", async () => {
    const order = await create("STRIPE"); await deliver(order.id); expect(await wallet()).toBe(BigInt(10500));
    const dispute = { id: `dp_${randomUUID()}`, object: "dispute", payment_intent: order.paymentIntentId, amount: 2300, currency: "bdt", status: "needs_response" };
    provider.disputes.set(dispute.id, dispute as never); await handleDisputeWebhook(dispute as never); expect(await wallet()).toBe(BigInt(0));
    provider.disputes.set(dispute.id, { ...dispute, status: "lost" } as never); await handleDisputeWebhook(dispute as never); expect(await wallet()).toBe(BigInt(8400));
  });
  it("authorizes current administrators and makes commercial policy writes exact and revision safe", async () => {
    const input = { action: "save-policy", scope: "SELLER", sellerId: seller.id, version: 1, terms: { commissionBps: 1250, shippingRecipient: "PLATFORM" }, requestId: randomUUID(), reason: "Actual approved commercial policy change", confirmed: true };
    await expect(mutateSellerSettlement(buyer, input)).rejects.toMatchObject({ status: 403 });
    const [first, retry] = await Promise.all([mutateSellerSettlement(admin, input), mutateSellerSettlement(admin, input)]); expect(first.result).toEqual(retry.result); expect(await mockDatabase.sellerSettlementPolicy.count({ where: { scopeKey: `SELLER:${seller.id}` } })).toBe(2);
    await expect(mutateSellerSettlement(admin, { ...input, terms: { ...input.terms, commissionBps: 500 } })).rejects.toMatchObject({ code: "SETTLEMENT_REQUEST_CONFLICT" });
    await expect(mutateSellerSettlement(admin, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "SETTLEMENT_POLICY_CHANGED" });
    await mockDatabase.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(mutateSellerSettlement(admin, input)).rejects.toMatchObject({ code: "SETTLEMENT_ACCOUNT_CHANGED" });
    await expect(mockDatabase.sellerSettlementRequest.deleteMany({ where: { actorId: admin.id } })).rejects.toThrow();
  });
  it("adopts explicitly reviewed terms once for a previously unconfigured actual purchase", async () => {
    const owner = await mockDatabase.user.create({ data: { email: `${randomUUID()}@unconfigured.example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    const owned = await mockDatabase.product.create({ data: { name: "Unconfigured purchase", slug: randomUUID(), price: 100, stock: 2, sellerId: owner.id, categoryId: category.id } });
    const order = await mockDatabase.order.create({ data: { userId: buyer.id, total: 100, status: "DELIVERED", paymentMethod: "COD", paymentStatus: "PAID", subtotalCents: BigInt(10000), discountCents: BigInt(0), shippingCents: BigInt(0), pricingEvidence: "Actual older financial snapshot", pricingReconciledAt: new Date(), items: { create: [{ productId: owned.id, quantity: 1, price: 100, netCents: BigInt(10000) }] } }, include: { fulfillments: true } });
    const shipment = order.fulfillments[0]; expect((await mockDatabase.sellerWallet.findUniqueOrThrow({ where: { sellerId: owner.id } })).balanceCents).toBe(BigInt(0));
    await mutateSellerSettlement(admin, { action: "save-policy", scope: "SELLER", sellerId: owner.id, version: 0, terms: { commissionBps: 800, shippingRecipient: "PLATFORM" }, requestId: randomUUID(), reason: "Actual reviewed terms for previously unconfigured seller", confirmed: true });
    const policy = await mockDatabase.sellerSettlementPolicy.findFirstOrThrow({ where: { scopeKey: `SELLER:${owner.id}` } });
    expect((await mockDatabase.sellerWallet.findUniqueOrThrow({ where: { sellerId: owner.id } })).balanceCents).toBe(BigInt(0));
    const input = { action: "adopt-policy", fulfillmentId: shipment.id, version: 1, policyId: policy.id, requestId: randomUUID(), reason: "Reviewed historic agreement and captured purchase value", confirmed: true };
    const saved = await mutateSellerSettlement(admin, input); expect((await mutateSellerSettlement(admin, input)).result).toEqual(saved.result);
    expect((await mockDatabase.sellerWallet.findUniqueOrThrow({ where: { sellerId: owner.id } })).balanceCents).toBe(BigInt(9200));
    await expect(mutateSellerSettlement(admin, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "SETTLEMENT_POLICY_CHANGED" });
  });
  it("deduplicates administrator payout instructions and confirmations without issuing or recording money twice", async () => {
    const order = await create(); await deliver(order.id);
    const input = { action: "start-payout", sellerId: seller.id, amountCents: "7000", method: "BANK", requestId: randomUUID(), reason: "Administrator reviewed this available payout amount", confirmed: true };
    const [first, retry] = await Promise.all([mutateSellerSettlement(admin, input), mutateSellerSettlement(admin, input)]); expect(first.result).toEqual(retry.result); expect(await wallet()).toBe(BigInt(3500));
    expect(await mockDatabase.sellerPayout.count({ where: { sellerId: seller.id } })).toBe(1); await expect(mutateSellerSettlement(admin, { ...input, amountCents: "8000" })).rejects.toMatchObject({ code: "SETTLEMENT_REQUEST_CONFLICT" });
    const payout = await mockDatabase.sellerPayout.findFirstOrThrow({ where: { sellerId: seller.id } });
    const confirmation = { action: "confirm-payout", payoutId: payout.id, version: 1, reference: randomUUID(), requestId: randomUUID(), reason: "Actual external transfer confirmed by administrator", confirmed: true };
    const recorded = await mutateSellerSettlement(admin, confirmation); expect((await mutateSellerSettlement(admin, confirmation)).result).toEqual(recorded.result); expect(await wallet()).toBe(BigInt(3500));
    await expect(mutateSellerSettlement(admin, { ...confirmation, requestId: randomUUID() })).rejects.toMatchObject({ code: "SETTLEMENT_PAYOUT_CHANGED" }); expect(await mockDatabase.sellerPayoutEvent.count({ where: { payoutId: payout.id } })).toBe(2);
  });
  it("reads actual scoped balances, monthly postings, shipment terms and original administrator receipts", async () => {
    const order = await create(); await deliver(order.id);
    const input = { action: "start-payout", sellerId: seller.id, amountCents: "1000", method: "BANK", requestId: randomUUID(), reason: "Administrator reviewed actual available balance", confirmed: true };
    await mutateSellerSettlement(admin, input);
    const overview = await readSellerSettlement(seller, {}); expect(overview).toMatchObject({ ownerId: seller.id, seller: { id: seller.id }, summary: { balanceCents: "9500", payableCents: "9500", receivableCents: "0", entitlementCents: "10500", reservedCents: "1000", paidCents: "0" } });
    expect(overview.mode).toBe("overview"); if (overview.mode !== "overview") throw Error("Wrong settlement mode"); expect(overview.monthly).toHaveLength(12); expect(overview.monthly[0]).toMatchObject({ entitlementChangeCents: "10500", reservationChangeCents: "1000", paidCents: "0" }); expect(overview.rows.map((row) => row.id)).toEqual([seller.id]);
    const shipments = await readSellerSettlement(seller, { mode: "shipments" }); expect(shipments.mode).toBe("shipments"); if (shipments.mode !== "shipments") throw Error("Wrong settlement mode"); expect(shipments.rows[0]).toMatchObject({ fulfillmentId: order.fulfillments[0].id, snapshotVersion: 1, effectiveCommissionBps: 1000, effectiveShippingRecipient: "SELLER", unallocatedDisputeLossCents: "0", projection: { availableCents: "10500", holds: [] } });
    const ledger = await readSellerSettlement(seller, { mode: "ledger" }); expect(ledger.total).toBe(2); const payouts = await readSellerSettlement(admin, { mode: "payouts", sellerId: seller.id, requestId: input.requestId }); expect(payouts.attempt).toMatchObject({ action: "start-payout", amountCents: "1000", status: "RESERVED" });
    expect((await readSellerSettlement(seller, { mode: "payouts", requestId: input.requestId })).attempt).toBeNull();
    await expect(readSellerSettlement(seller, { mode: "ledger", page: 2 })).rejects.toMatchObject({ code: "SETTLEMENT_PAGE" });
    const other = await mockDatabase.user.create({ data: { email: `${randomUUID()}@other.example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    await expect(readSellerSettlement(other, { sellerId: seller.id })).rejects.toMatchObject({ status: 403 }); await expect(readSellerSettlement(buyer, {})).rejects.toMatchObject({ status: 403 });
    const policies = await readSellerSettlement(seller, { mode: "policies" }); if (policies.mode !== "policies") throw Error("Wrong settlement mode"); expect(policies.rows.every((row) => ["GLOBAL", `SELLER:${seller.id}`].includes(row.scopeKey))).toBe(true);
    expect(JSON.stringify(overview)).not.toContain('"password"');
  });
  it("guards the private HTTP contract, bounded body, strict fields and current viewer header", async () => {
    const api = await import("@/app/api/settlements/route"), request = (query = "", body?: unknown, owner = admin.id) => new Request(`http://localhost/api/settlements${query}`, { method: body ? "POST" : "GET", headers: { "X-Settlement-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    expect((await api.GET(request())).headers.get("cache-control")).toBe("private, no-store"); expect((await api.GET(request("", undefined, seller.id))).status).toBe(409); expect((await api.GET(request("?page=1&page=2"))).status).toBe(400);
    expect((await api.POST(request("", { padding: "x".repeat(16385) }))).status).toBe(413);
    const intent = { action: "save-policy", scope: "SELLER", sellerId: seller.id, version: 1, terms: { commissionBps: 500, shippingRecipient: "SELLER" }, requestId: randomUUID(), reason: "Actual administrator reviewed commission change", confirmed: true };
    expect((await api.POST(request("", { ...intent, actorId: admin.id }))).status).toBe(400); expect((await api.POST(request("", intent))).status).toBe(200);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); const limited = await api.GET(request()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBeTruthy();
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(403);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller); expect((await api.POST(request("", { ...intent, requestId: randomUUID() }, seller.id))).status).toBe(403);
  });
  it("resolves uncertain original UUIDs on the server so a delayed request cannot execute after abandonment", async () => {
    const order = await create(); await deliver(order.id);
    const intent = { action: "start-payout", sellerId: seller.id, amountCents: "1000", method: "BANK", requestId: randomUUID(), reason: "Reviewed actual payout before network interruption", confirmed: true };
    const stopped = await mutateSellerSettlement(admin, { action: "abandon-request", originalIntent: intent, confirmed: true }); expect(stopped.result).toMatchObject({ status: "ABANDONED", originalAction: "start-payout" });
    expect((await mutateSellerSettlement(admin, intent)).result).toEqual(stopped.result); expect(await wallet()).toBe(BigInt(10500)); expect(await mockDatabase.sellerPayout.count({ where: { sellerId: seller.id } })).toBe(0);
    const committed = { ...intent, requestId: randomUUID() }, saved = await mutateSellerSettlement(admin, committed);
    expect((await mutateSellerSettlement(admin, { action: "abandon-request", originalIntent: committed, confirmed: true })).result).toEqual(saved.result); expect(await wallet()).toBe(BigInt(9500));
    const racing = { ...intent, requestId: randomUUID() }, race = await Promise.all([mutateSellerSettlement(admin, { action: "abandon-request", originalIntent: racing, confirmed: true }), mutateSellerSettlement(admin, racing)]); expect(race[0].result).toEqual(race[1].result);
    const payouts = await mockDatabase.sellerPayout.count({ where: { sellerId: seller.id } }); expect([1, 2]).toContain(payouts); expect(await wallet()).toBe(BigInt(10500 - payouts * 1000));
  });
});
