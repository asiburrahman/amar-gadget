import type { PrismaClient, User, Product, Category } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { refundProviderFixture } from "@/tests/helpers/refund-provider";
import { quoteRefund, requestRefund, mutateRefundLocally, readRefundOrder } from "@/lib/refunds";
import { processCardRefund, handleRefundWebhook, handleDisputeWebhook, recoverMissingRefund } from "@/lib/stripe/refunds";
import { mutateFulfillment, readSellerFulfillments } from "@/lib/fulfillments";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { readReviewAccess, createVerifiedReview, moderateVerifiedReview, readPublicReviews } from "@/lib/reviews";
import { netCollectedRevenue } from "@/lib/financial-metrics";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("authorized refunds, returns and provider reconciliation with actual PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, provider: ReturnType<typeof refundProviderFixture>;
  let admin: User, seller: User, secondSeller: User, buyer: User, other: User, category: Category, products: Product[];
  const prefix = `audit-refund-${randomUUID()}`;
  beforeAll(async () => {
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db; provider = refundProviderFixture(mockDatabase);
    [admin, seller, secondSeller, other] = await Promise.all(["admin", "seller", "second-seller", "other"].map((name) => mockDatabase.user.create({ data: { email: `${prefix}-${name}@example.invalid`, role: name === "admin" ? "ADMIN" : name === "other" ? "USER" : "MEMBER", sellerStatus: "APPROVED", isVerified: true } })));
    category = await mockDatabase.category.create({ data: { name: prefix, slug: prefix } });
  }, 30_000);
  beforeEach(async () => {
    jest.clearAllMocks(); provider.state.mode = "succeeded"; (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    admin = await mockDatabase.user.findUniqueOrThrow({ where: { id: admin.id } }); (getCurrentUser as jest.Mock).mockResolvedValue(admin);
    buyer = await mockDatabase.user.create({ data: { email: `${prefix}-buyer-${randomUUID()}@example.invalid`, role: "USER", isVerified: true } });
    products = await Promise.all([seller, secondSeller].map((owner, i) => mockDatabase.product.create({ data: { name: `${prefix}-${randomUUID()}`, slug: randomUUID(), price: 100 + i * 100, stock: 100, status: "APPROVED", categoryId: category.id, sellerId: owner.id } })));
  });
  afterAll(async () => { provider?.restore(); await fixture?.close(); });
  const create = (paymentMethod = "STRIPE", legacy = false) => mockDatabase.order.create({ data: { userId: buyer.id, total: 600, paymentMethod, paymentStatus: paymentMethod === "STRIPE" ? "PAID" : "UNPAID", status: "PROCESSING", ...(paymentMethod === "STRIPE" ? { paymentIntentId: `pi_${randomUUID()}` } : {}), ...(!legacy ? { subtotalCents: BigInt(50000), discountCents: BigInt(5000), shippingCents: BigInt(15000), pricingEvidence: "Verified isolated purchase quote", pricingReconciledAt: new Date() } : {}), items: { create: products.map((product, i) => ({ productId: product.id, quantity: i ? 1 : 3, price: product.price, ...(!legacy ? { netCents: BigInt(i ? 18000 : 27000) } : {}) })) } }, include: { items: true, fulfillments: true } });
  const request = async (orderId: string, selection: "FULL" | { itemId: string; quantity: number }[] = "FULL") => {
    const order = await mockDatabase.order.findUniqueOrThrow({ where: { id: orderId } });
    return requestRefund(admin, { orderId, version: order.refundVersion, requestId: randomUUID(), reason: "Customer requested this actual reimbursement", selection });
  };
  const dispatch = async (orderId: string, deliver = false) => {
    for (const owner of [seller, secondSeller]) {
      const row = (await readSellerFulfillments(owner, { orderId })).shipments[0];
      const shipped = await mutateFulfillment(owner, { fulfillmentId: row.id, version: row.version, action: "ship", carrier: "Actual courier", trackingNumber: `TRACK-${row.id}` });
      if (deliver) await mutateFulfillment(admin, { fulfillmentId: row.id, version: shipped.shipment.version, action: "deliver", codMoneyReceived: row.paymentMethod === "COD" });
    }
  };
  it("quotes immutable discounted purchases, refunds quantities and proportionate shipping, then closes and restocks all remaining units once", async () => {
    const order = await create(), first = order.items.find((item) => item.productId === products[0].id)!;
    const selection = [{ itemId: first.id, quantity: 1 }];
    expect(await quoteRefund(admin, { orderId: order.id, version: order.refundVersion, selection })).toMatchObject({ quote: { amountCents: 12000, shippingCents: 3000 } });
    const pending = await request(order.id, selection), group = order.fulfillments.find((row) => row.sellerId === seller.id)!;
    await expect(mutateFulfillment(seller, { fulfillmentId: group.id, version: 1, action: "ship", carrier: "Courier", trackingNumber: "BLOCKED" })).rejects.toMatchObject({ code: "FULFILLMENT_FINANCIAL_HOLD" });
    await processCardRefund(pending.refund.id, admin, pending.refund.version);
    expect(await mockDatabase.orderItem.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ refundedQuantity: 1, voidedQuantity: 1, retainedQuantity: 2, refundedCents: BigInt(9000) });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(101);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ refundState: "PARTIAL", refundedCents: BigInt(12000), shippingRefundedCents: BigInt(3000) });
    expect((await readSellerFulfillments(seller, { orderId: order.id })).shipments[0].items[0].quantity).toBe(2);
    const remaining = await request(order.id); expect(remaining.refund.amountCents).toBe(48000);
    await processCardRefund(remaining.refund.id, admin, remaining.refund.version);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "CANCELLED", paymentStatus: "PAID", refundedCents: BigInt(60000), refundState: "REFUNDED" });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(103); expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[1].id } })).stock).toBe(101);
    await processCardRefund(remaining.refund.id); expect(provider.create).toHaveBeenCalledTimes(2);
  });
  it("serializes competing refund requests and deduplicates the exact original intent", async () => {
    const order = await create(), input = { orderId: order.id, version: order.refundVersion, requestId: randomUUID(), reason: "Original precise refund intent", selection: "FULL" };
    const same = await Promise.all([requestRefund(admin, input), requestRefund(admin, input)]); expect(same[0].refund.id).toBe(same[1].refund.id);
    expect(await mockDatabase.refund.count({ where: { orderId: order.id } })).toBe(1);
    await expect(requestRefund(admin, { ...input, reason: "Different reused intent" })).rejects.toMatchObject({ code: "REFUND_REQUEST_CONFLICT" });
    const another = await create(), body = { ...input, orderId: another.id, version: another.refundVersion };
    const competing = await Promise.allSettled([requestRefund(admin, { ...body, requestId: randomUUID() }), requestRefund(admin, { ...body, requestId: randomUUID() })]); expect(competing.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  });
  it("recovers provider response loss by the saved metadata/key without issuing money twice", async () => {
    const order = await create(), pending = await request(order.id); provider.state.mode = "throw-after-create";
    await expect(processCardRefund(pending.refund.id)).rejects.toMatchObject({ code: "REFUND_PROVIDER_UNAVAILABLE" });
    expect(await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } })).toMatchObject({ status: "SUBMITTING", providerRefundId: null });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100);
    await processCardRefund(pending.refund.id);
    expect(provider.create).toHaveBeenCalledTimes(1); expect(provider.create.mock.calls[0][1]?.idempotencyKey).toBe(`amar-refund-${pending.refund.id}`);
    expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).refundedCents).toBe(BigInt(60000));
  });
  it("waits for actual provider success, reconciles duplicate/out-of-order signed webhooks and preserves completed evidence", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_isolated_refund_provider"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_isolated_refund_provider";
    const order = await create(), pending = await request(order.id); provider.state.mode = "pending"; await processCardRefund(pending.refund.id);
    let row = await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } }); expect(row.status).toBe("PENDING"); expect(row.appliedAt).toBeNull();
    const actual = provider.refunds.get(row.providerRefundId!)!; actual.status = "succeeded";
    const { POST } = await import("@/app/api/stripe/webhook/route"), eventId = `evt_${randomUUID()}`;
    const send = async (id: string, snapshotStatus: string) => {
      const payload = JSON.stringify({ id, type: "refund.updated", data: { object: { ...actual, status: snapshotStatus } } });
      return POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": provider.stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! }) } }));
    };
    expect((await send(eventId, "pending")).status).toBe(200); expect((await send(eventId, "pending")).status).toBe(200); expect((await send(`evt_${randomUUID()}`, "pending")).status).toBe(200);
    row = await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } }); expect(row.status).toBe("SUCCEEDED"); expect(row.appliedAt).not.toBeNull();
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(103); expect(await mockDatabase.financialWebhookReceipt.count({ where: { id: eventId } })).toBe(1);
    await expect(mockDatabase.financialEvent.updateMany({ where: { orderId: order.id }, data: { kind: "fabricated" } })).rejects.toThrow();
  });
  it("keeps failed provider refunds out of financial/stock totals and permits a new, separately approved attempt", async () => {
    const order = await create(), first = await request(order.id); provider.state.mode = "failed"; await processCardRefund(first.refund.id);
    expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).refundedCents).toBe(BigInt(0)); expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100);
    const second = await request(order.id); provider.state.mode = "succeeded"; await processCardRefund(second.refund.id);
    expect(second.refund.id).not.toBe(first.refund.id); expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).refundState).toBe("REFUNDED");
  });
  it("refunds delivered units without shipping or automatic restock, adjusts reviews, then accepts only inspected physical returns once", async () => {
    const order = await create(); await dispatch(order.id, true);
    const first = order.items.find((item) => item.productId === products[0].id)!, review = await createVerifiedReview(buyer, { productId: products[0].id, rating: 4, comment: "Actual delivered paid purchase" }); await moderateVerifiedReview(admin, { id: review.id, version: review.version, action: "publish" });
    const refund = await request(order.id, [{ itemId: first.id, quantity: 3 }]); expect(refund.refund).toMatchObject({ amountCents: 27000, shippingCents: 0 }); await processCardRefund(refund.refund.id);
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100); expect((await readPublicReviews(products[0].id)).total).toBe(0); expect((await readReviewAccess(buyer, products[1].id)).eligible).toBe(true);
    const current = await mockDatabase.orderItem.findUniqueOrThrow({ where: { id: first.id } }), body = { action: "return", orderId: order.id, itemId: first.id, version: current.financialVersion, requestId: randomUUID(), quantity: 2, inspectedAndAccepted: true, evidence: "Warehouse receipt and physical inspection accepted" };
    await mutateRefundLocally(admin, body); await mutateRefundLocally(admin, body);
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(102); expect((await mockDatabase.orderItem.findUniqueOrThrow({ where: { id: first.id } })).returnedQuantity).toBe(2);
    await expect(mutateRefundLocally(admin, { ...body, requestId: randomUUID(), version: current.financialVersion + 1, quantity: 2 })).rejects.toMatchObject({ code: "REFUND_RETURN" });
  });
  it("refunds only collected COD shipments and requires actual external repayment evidence", async () => {
    const order = await create("COD"); await dispatch(order.id);
    const first = await mockDatabase.orderFulfillment.findFirstOrThrow({ where: { orderId: order.id, sellerId: seller.id } });
    await mutateFulfillment(admin, { fulfillmentId: first.id, version: first.version, action: "deliver", codMoneyReceived: true });
    const pending = await request(order.id); expect(pending.refund).toMatchObject({ amountCents: 27000, shippingCents: 0 });
    await expect(processCardRefund(pending.refund.id, admin, pending.refund.version)).rejects.toMatchObject({ code: "REFUND_PAYMENT" });
    await expect(mutateRefundLocally(admin, { action: "confirm-cod", refundId: pending.refund.id, version: pending.refund.version, moneyReturned: false, method: "BKASH", reference: "ACTUAL-TRANSACTION" })).rejects.toThrow();
    await mutateRefundLocally(admin, { action: "confirm-cod", refundId: pending.refund.id, version: pending.refund.version, moneyReturned: true, method: "BKASH", reference: "ACTUAL-TRANSACTION" });
    expect(await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } })).toMatchObject({ status: "SUCCEEDED", manualMethod: "BKASH", manualReference: "ACTUAL-TRANSACTION", confirmedById: admin.id });
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ paymentStatus: "UNPAID", refundedCents: BigInt(27000) }); expect(provider.create).not.toHaveBeenCalled();
    const customer = await readRefundOrder(buyer, order.id), serialized = JSON.stringify(customer);
    for (const hidden of ["ACTUAL-TRANSACTION", "confirmedById", "providerRefundId", "requestHash", "createdById"]) expect(serialized).not.toContain(hidden);
    await expect(readRefundOrder(other, order.id)).rejects.toMatchObject({ code: "REFUND_NOT_FOUND" });
  });
  it("closes only the refunded undispatched package in a mixed delivered order and preserves its dispatched sibling", async () => {
    const order = await create(), own = (await readSellerFulfillments(seller, { orderId: order.id })).shipments[0];
    const shipped = await mutateFulfillment(seller, { fulfillmentId: own.id, version: own.version, action: "ship", carrier: "Courier", trackingNumber: "MIXED-REFUND" });
    await mutateFulfillment(admin, { fulfillmentId: own.id, version: shipped.shipment.version, action: "deliver", codMoneyReceived: false });
    const refund = await request(order.id); expect(refund.refund).toMatchObject({ amountCents: 51000, shippingCents: 6000 }); await processCardRefund(refund.refund.id);
    expect((await mockDatabase.orderFulfillment.findMany({ where: { orderId: order.id }, orderBy: { sellerId: "asc" } })).map((group) => group.status).sort()).toEqual(["CANCELLED", "DELIVERED"]);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "DELIVERED", refundedCents: BigInt(51000) });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100); expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[1].id } })).stock).toBe(101);
  });
  it("requires evidence-backed historical pricing and ignores changed catalog prices", async () => {
    const order = await create("STRIPE", true); await expect(request(order.id)).rejects.toMatchObject({ code: "REFUND_PRICING_REQUIRED" });
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { price: 999 } });
    await mutateRefundLocally(admin, { action: "pricing", orderId: order.id, version: order.refundVersion, shippingCents: 15000, evidence: "Verified original invoice shipping and order total" });
    const saved = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved).toMatchObject({ subtotalCents: BigInt(50000), discountCents: BigInt(5000), shippingCents: BigInt(15000) });
    await expect(mutateRefundLocally(admin, { action: "pricing", orderId: order.id, version: saved.refundVersion, shippingCents: 0, evidence: "Attempt to overwrite verified original pricing" })).rejects.toMatchObject({ code: "REFUND_PRICING_EXISTS" });
    expect((await request(order.id)).refund.amountCents).toBe(60000);
  });
  it("records external provider money before attribution, then restores correct item eligibility after an audited allocation", async () => {
    const order = await create(); await dispatch(order.id, true);
    const review = await createVerifiedReview(buyer, { productId: products[0].id, rating: 4, comment: "Actual delivered product feedback" }); await moderateVerifiedReview(admin, { id: review.id, version: review.version, action: "publish" });
    const object = { id: `re_${randomUUID()}`, object: "refund", currency: "bdt", amount: 1000, payment_intent: order.paymentIntentId, metadata: { orderId: order.id }, status: "succeeded", created: Math.floor(Date.now() / 1000) } as unknown as Stripe.Refund; provider.refunds.set(object.id, object);
    const before = await netCollectedRevenue(); await handleRefundWebhook(object);
    expect(await netCollectedRevenue()).toBe(before - 10); expect((await readPublicReviews(products[0].id)).total).toBe(0);
    const external = await mockDatabase.refund.findUniqueOrThrow({ where: { providerRefundId: object.id } }), item = order.items.find((item) => item.productId === products[0].id)!;
    expect(external).toMatchObject({ status: "SUCCEEDED", kind: "EXTERNAL", allocationConfirmed: false });
    await mutateRefundLocally(admin, { action: "allocate-external", refundId: external.id, version: external.version, shippingCents: 0, evidence: "Verified provider amount-only adjustment for first item", lines: [{ itemId: item.id, quantity: 0, amountCents: 1000 }] });
    expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).financialReviewReason).toBeNull(); expect((await readPublicReviews(products[0].id)).total).toBe(1);
    expect((await mockDatabase.orderItem.findUniqueOrThrow({ where: { id: item.id } })).refundedCents).toBe(BigInt(1000)); expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100);
  });
  it("reconciles current dispute truth, restores won eligibility, and deducts actual lost principal without restocking", async () => {
    const order = await create(); await dispatch(order.id, true);
    const review = await createVerifiedReview(buyer, { productId: products[0].id, rating: 4, comment: "Actual paid purchase before provider dispute" }); await moderateVerifiedReview(admin, { id: review.id, version: review.version, action: "publish" });
    const dispute = { id: `du_${randomUUID()}`, payment_intent: order.paymentIntentId, currency: "bdt", amount: 15000, status: "needs_response", balance_transactions: [] } as unknown as Stripe.Dispute; provider.disputes.set(dispute.id, dispute);
    await handleDisputeWebhook(dispute); expect((await readPublicReviews(products[0].id)).total).toBe(0); await expect(request(order.id)).rejects.toMatchObject({ code: "REFUND_REVIEW" });
    dispute.status = "won"; await handleDisputeWebhook({ ...dispute, status: "needs_response" }); expect((await readPublicReviews(products[0].id)).total).toBe(1);
    const before = await netCollectedRevenue(); dispute.status = "lost"; dispute.balance_transactions = [{ amount: -15000 } as Stripe.BalanceTransaction]; await handleDisputeWebhook(dispute);
    expect(await netCollectedRevenue()).toBe(before - 150); expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ disputeStatus: "LOST", disputeAmountCents: BigInt(15000) });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100);
  });
  it("aggregates every dispute beyond a display-page boundary and preserves lost/active/closed precedence and exact funds", async () => {
    const closed = await create();
    await mockDatabase.paymentDispute.createMany({ data: Array.from({ length: 150 }, (_, index) => ({ id: `du_${randomUUID()}`, orderId: closed.id, status: index % 2 ? "won" : "warning_closed", amountCents: BigInt(50), fundsLostCents: BigInt(0) })) });
    const current = { id: `du_${randomUUID()}`, payment_intent: closed.paymentIntentId, currency: "bdt", amount: 50, status: "needs_response", balance_transactions: [] } as unknown as Stripe.Dispute;
    provider.disputes.set(current.id, current); await handleDisputeWebhook(current);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: closed.id } })).toMatchObject({ disputeStatus: "ACTIVE", disputeAmountCents: BigInt(0) });
    current.status = "won"; await handleDisputeWebhook(current);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: closed.id } })).toMatchObject({ disputeStatus: "WON", disputeAmountCents: BigInt(0) });

    const lost = await create();
    await mockDatabase.paymentDispute.createMany({ data: Array.from({ length: 152 }, (_, index) => ({ id: `du_${randomUUID()}`, orderId: lost.id, status: index === 0 || index === 151 ? "lost" : "won", amountCents: BigInt(200), fundsLostCents: BigInt(index === 0 ? 100 : index === 151 ? 200 : 0) })) });
    const latest = { ...current, id: `du_${randomUUID()}`, payment_intent: lost.paymentIntentId, status: "needs_response" } as Stripe.Dispute;
    provider.disputes.set(latest.id, latest); await handleDisputeWebhook(latest);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({ disputeStatus: "LOST", disputeAmountCents: BigInt(300) });
    latest.status = "lost"; latest.balance_transactions = [{ amount: -50 } as Stripe.BalanceTransaction]; await handleDisputeWebhook(latest);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({ disputeStatus: "LOST", disputeAmountCents: BigInt(350) });
    expect(await mockDatabase.paymentDispute.count({ where: { orderId: lost.id } })).toBe(153);
  });
  it("rejects reusing a COD receipt for another refund without changing its money or stock", async () => {
    const first = await create("COD"), second = await create("COD"); await dispatch(first.id, true); await dispatch(second.id, true);
    const one = await request(first.id), two = await request(second.id), confirm = (id: string, version: number) => mutateRefundLocally(admin, { action: "confirm-cod", refundId: id, version, moneyReturned: true, method: "BANK", reference: "ONE-ACTUAL-REPAYMENT-REFERENCE" });
    await confirm(one.refund.id, one.refund.version); await expect(confirm(two.refund.id, two.refund.version)).rejects.toMatchObject({ code: "P2002" });
    expect((await mockDatabase.refund.findUniqueOrThrow({ where: { id: two.refund.id } })).status).toBe("QUEUED"); expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: second.id } })).refundedCents).toBe(BigInt(0));
  });
  it("does not restore previously released inventory when refunding a late-paid cancelled order", async () => {
    const order = await mockDatabase.order.create({ data: { userId: buyer.id, total: 100, status: "CANCELLED", paymentMethod: "STRIPE", paymentStatus: "PAID", paymentIntentId: `pi_${randomUUID()}`, subtotalCents: BigInt(10000), discountCents: BigInt(0), shippingCents: BigInt(0), pricingEvidence: "Verified late capture on a closed reservation", pricingReconciledAt: new Date(), items: { create: { productId: products[0].id, quantity: 1, price: 100, netCents: BigInt(10000) } } } });
    const pending = await request(order.id); await processCardRefund(pending.refund.id);
    expect((await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).refundState).toBe("REFUNDED"); expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100);
  });
  it("serializes provider work and rechecks an administrator revoked during provider verification", async () => {
    const order = await create(), pending = await request(order.id);
    const original = provider.payment.getMockImplementation()!;
    let reached!: () => void, release!: () => void;
    const verifying = new Promise<void>((resolve) => { reached = resolve; }), resume = new Promise<void>((resolve) => { release = resolve; });
    provider.payment.mockImplementationOnce(async (...args) => { reached(); await resume; return original(...args); });
    const work = processCardRefund(pending.refund.id, admin, pending.refund.version);
    await verifying;
    expect(await processCardRefund(pending.refund.id)).toMatchObject({ busyOrComplete: true });
    await mockDatabase.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } }); release();
    await expect(work).rejects.toMatchObject({ code: "REFUND_ACCOUNT_CHANGED" }); expect(provider.create).not.toHaveBeenCalled();
    expect((await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } })).status).toBe("REVIEW");
  });
  it("never recreates an uncertain intent after its safety window and requires explicit provider-history recovery", async () => {
    const order = await create(), pending = await request(order.id);
    await mockDatabase.refund.update({ where: { id: pending.refund.id }, data: { status: "SUBMITTING", submittedAt: new Date(Date.now() - 25 * 60 * 60_000), providerPaymentIntentId: order.paymentIntentId, version: { increment: 1 } } });
    await expect(processCardRefund(pending.refund.id)).rejects.toMatchObject({ code: "REFUND_IDEMPOTENCY_REVIEW" }); expect(provider.create).not.toHaveBeenCalled();
    const saved = await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } });
    await recoverMissingRefund(saved.id, admin, saved.version, "Verified actual provider history after the safe retry window");
    expect((await mockDatabase.refund.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe("CANCELLED");
    const replacement = await request(order.id); await processCardRefund(replacement.refund.id);
    expect(provider.create).toHaveBeenCalledTimes(1); expect(provider.create.mock.calls[0][1]?.idempotencyKey).toBe(`amar-refund-${replacement.refund.id}`);
  });
  it("keeps physical stock after provider reversal and covers the repayment debt without restocking twice", async () => {
    const order = await create(), pending = await request(order.id); await processCardRefund(pending.refund.id);
    const saved = await mockDatabase.refund.findUniqueOrThrow({ where: { id: pending.refund.id } }), actual = provider.refunds.get(saved.providerRefundId!)!;
    actual.status = "failed"; await handleRefundWebhook(actual);
    let current = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(current).toMatchObject({ refundedCents: BigInt(0), financialReviewReason: "PROVIDER_REFUND_REVERSED" });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(103);
    await mutateRefundLocally(admin, { action: "resolve-review", orderId: order.id, version: current.refundVersion, evidence: "Actual provider reversal confirmed; replacement repayment still required" });
    current = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } }); expect(current.financialReviewReason).toBe("VOIDED_REFUND_REPAYMENT_REQUIRED");
    const replacement = await request(order.id); await processCardRefund(replacement.refund.id);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ refundedCents: BigInt(60000), financialReviewReason: null });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(103);
  });
  it("rolls back an inspected return, its receipt, history and quantity when stock cannot be restored", async () => {
    const order = await create(); await dispatch(order.id, true);
    const item = await mockDatabase.orderItem.findFirstOrThrow({ where: { orderId: order.id, productId: products[0].id } });
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { stock: 2147483647 } });
    const count = await mockDatabase.financialEvent.count({ where: { orderId: order.id } }), requestId = randomUUID();
    await expect(mutateRefundLocally(admin, { action: "return", orderId: order.id, itemId: item.id, version: item.financialVersion, requestId, quantity: 1, inspectedAndAccepted: true, evidence: "Received and inspected actual returned unit" })).rejects.toThrow();
    expect(await mockDatabase.orderReturn.count({ where: { requestId } })).toBe(0); expect(await mockDatabase.financialEvent.count({ where: { orderId: order.id } })).toBe(count);
    expect((await mockDatabase.orderItem.findUniqueOrThrow({ where: { id: item.id } })).returnedQuantity).toBe(0);
  });
  it("enforces private handlers, role/owner/revision gates, strict bounded input and rate limits", async () => {
    const api = await import("@/app/api/admin/refunds/route"), customerApi = await import("@/app/api/user/refunds/route"), order = await create();
    const http = (path = `/api/admin/refunds?orderId=${order.id}`, method = "GET", body?: unknown, owner = admin.id) => new Request(`http://localhost${path}`, { method, headers: { "X-Refund-Owner": owner }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    (getCurrentUser as jest.Mock).mockResolvedValue(null); expect((await api.GET(http())).status).toBe(401);
    (getCurrentUser as jest.Mock).mockResolvedValue(buyer); expect((await api.GET(http(undefined, "GET", undefined, buyer.id))).status).toBe(403);
    const own = await customerApi.GET(http(`/api/user/refunds?orderId=${order.id}`, "GET", undefined, buyer.id)); expect(own.status).toBe(200); expect(own.headers.get("cache-control")).toBe("private, no-store");
    (getCurrentUser as jest.Mock).mockResolvedValue(other); expect((await customerApi.GET(http(`/api/user/refunds?orderId=${order.id}`, "GET", undefined, other.id))).status).toBe(404);
    (getCurrentUser as jest.Mock).mockResolvedValue(admin); expect((await api.GET(http(undefined, "GET", undefined, buyer.id))).status).toBe(409); expect((await api.GET(http(`/api/admin/refunds?orderId=${order.id}&page=1&page=2`))).status).toBe(400);
    const body = { action: "request", request: { orderId: order.id, version: order.refundVersion, requestId: randomUUID(), reason: "Real authorized request reason", selection: "FULL" } };
    expect((await api.POST(http("/api/admin/refunds", "POST", { ...body, amountCents: 1 }))).status).toBe(400);
    expect((await api.POST(http("/api/admin/refunds", "POST", { ...body, padding: "x".repeat(17000) }))).status).toBe(413);
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); const limited = await api.GET(http()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
  });
});
