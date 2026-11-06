import type { PrismaClient, User, Product, Category } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { mutateFulfillment, readSellerFulfillments } from "@/lib/fulfillments";
import { requestRefund, mutateRefundLocally } from "@/lib/refunds";
import { mutateSellerSettlement } from "@/lib/seller-settlement";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("transactional notification source capture with PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, seller: User, other: User, buyer: User, category: Category, products: Product[];
  beforeAll(async () => { fixture = await createFinanceDatabase(); mockDatabase = fixture.db; }, 30_000);
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    [admin, seller, other, buyer] = await Promise.all(["ADMIN", "MEMBER", "MEMBER", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@notification.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } }); products = await Promise.all([seller, other].map((owner, index) => mockDatabase.product.create({ data: { name: `Captured own product ${index}`, slug: randomUUID(), price: 100 + index * 100, stock: 10, sellerId: owner.id, categoryId: category.id, status: "APPROVED" } })));
  });
  const create = () => mockDatabase.order.create({ data: { userId: buyer.id, total: 300, status: "PROCESSING", paymentMethod: "COD", shippingAddress: "Private recipient destination", shippingPhone: "01700000000", subtotalCents: BigInt(30000), discountCents: BigInt(0), shippingCents: BigInt(0), pricingEvidence: "Actual notification fixture purchase", pricingReconciledAt: new Date(), items: { create: products.map((product) => ({ productId: product.id, quantity: 1, price: product.price, netCents: BigInt(product.price.mul(100).toFixed(0)) })) } }, include: { fulfillments: true, items: true } });
  const deliver = async (orderId: string, owner: User) => { const shipment = (await readSellerFulfillments(owner, { orderId })).shipments[0], shipped = await mutateFulfillment(owner, { action: "ship", fulfillmentId: shipment.id, version: shipment.version, carrier: "Actual courier", trackingNumber: randomUUID() }); await mutateFulfillment(admin, { action: "deliver", fulfillmentId: shipment.id, version: shipped.shipment.version, codMoneyReceived: true }); };
  it("captures verified seller applications, status decisions and product review/approval without credential data", async () => {
    const pending = await mockDatabase.user.create({ data: { email: `${randomUUID()}@pending.example.invalid`, role: "MEMBER", sellerStatus: "PENDING", isVerified: false } });
    expect(await mockDatabase.notificationEvent.count({ where: { subjectId: pending.id } })).toBe(0);
    await mockDatabase.user.update({ where: { id: pending.id }, data: { isVerified: true } }); await mockDatabase.user.update({ where: { id: pending.id }, data: { sellerStatus: "APPROVED", password: "not-a-real-credential" } });
    const userEvents = await mockDatabase.notificationEvent.findMany({ where: { subjectId: pending.id } }); expect(userEvents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "SELLER_APPLICATION", audience: "ADMIN", recipientGroup: "ADMINS", recipientId: null }), expect.objectContaining({ kind: "SELLER_STATUS", audience: "SELLER", recipientId: pending.id, data: { status: "APPROVED" } })]));
    expect(JSON.stringify(userEvents)).not.toContain(pending.email); expect(JSON.stringify(userEvents)).not.toContain("not-a-real-credential");
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { name: "Reviewed actual metadata", status: "PENDING_APPROVAL" } });
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { status: "APPROVED" } });
    const events = await mockDatabase.notificationEvent.findMany({ where: { subjectId: products[0].id } }); expect(events).toHaveLength(2); expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "PRODUCT_REVIEW", recipientGroup: "ADMINS" }), expect.objectContaining({ kind: "PRODUCT_STATUS", audience: "SELLER", recipientId: seller.id, data: { status: "APPROVED" } })]));
  });
  it("captures own order/shipment assignment and actual payment transitions without leaking shared-order private fields", async () => {
    const order = await create(); const placed = await mockDatabase.notificationEvent.findMany({ where: { subjectId: order.id, kind: "ORDER_PLACED" } }); expect(placed).toHaveLength(2); expect(placed).toEqual(expect.arrayContaining([expect.objectContaining({ audience: "ACCOUNT", recipientId: buyer.id }), expect.objectContaining({ audience: "ADMIN", recipientGroup: "ADMINS" })]));
    for (const shipment of order.fulfillments) expect(await mockDatabase.notificationEvent.findFirst({ where: { subjectId: shipment.id, kind: "SHIPMENT_ASSIGNED" } })).toMatchObject({ audience: "SELLER", recipientId: shipment.sellerId });
    await deliver(order.id, seller); expect(await mockDatabase.notificationEvent.count({ where: { subjectId: order.id, kind: "PAYMENT_STATUS" } })).toBe(0);
    await deliver(order.id, other); const payment = await mockDatabase.notificationEvent.findMany({ where: { subjectId: order.id, kind: "PAYMENT_STATUS" } }); expect(payment).toHaveLength(3); expect(payment.every((event) => JSON.stringify(event.data) === '{"status":"PAID"}')).toBe(true);
    const all = await mockDatabase.notificationEvent.findMany({ where: { OR: [{ subjectId: order.id }, { subjectId: { in: order.fulfillments.map((row) => row.id) } }] } }); const serialized = JSON.stringify(all); for (const privateValue of [buyer.email, order.shippingAddress!, order.shippingPhone!]) expect(serialized).not.toContain(privateValue);
    expect(await mockDatabase.notification.count({ where: { eventId: { in: all.map((event) => event.id) } } })).toBe(0); expect(all.every((event) => event.state === "READY")).toBe(true);
  });
  it("queues actual refund and payout state with no external bank reference or freeform operator evidence", async () => {
    await mutateSellerSettlement(admin, { action: "save-policy", scope: "SELLER", sellerId: seller.id, version: 0, terms: { commissionBps: 1000, shippingRecipient: "PLATFORM" }, requestId: randomUUID(), reason: "Private commercial agreement evidence", confirmed: true });
    const order = await create(); await deliver(order.id, seller); await deliver(order.id, other);
    const payout = await mutateSellerSettlement(admin, { action: "start-payout", sellerId: seller.id, amountCents: "1000", method: "BANK", requestId: randomUUID(), reason: "Private payout evidence", confirmed: true }); const actual = await mockDatabase.sellerPayout.findFirstOrThrow({ where: { sellerId: seller.id } });
    expect(payout.result).toMatchObject({ id: actual.id }); await mutateSellerSettlement(admin, { action: "confirm-payout", payoutId: actual.id, version: 1, reference: "PRIVATE-BANK-REFERENCE", requestId: randomUUID(), reason: "Private external transfer evidence", confirmed: true });
    const payoutEvents = await mockDatabase.notificationEvent.findMany({ where: { subjectId: actual.id } }); expect(payoutEvents).toHaveLength(2); expect(payoutEvents.map((event) => event.data)).toEqual(expect.arrayContaining([{ status: "RESERVED" }, { status: "PAID" }])); expect(JSON.stringify(payoutEvents)).not.toContain("PRIVATE-BANK-REFERENCE");
    const current = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } }), pending = await requestRefund(admin, { orderId: order.id, version: current.refundVersion, requestId: randomUUID(), reason: "Private customer reimbursement evidence", selection: [{ itemId: order.items[0].id, quantity: 1 }] });
    const queued = await mockDatabase.notificationEvent.findMany({ where: { subjectId: order.id, kind: "REFUND_STATUS" } }); expect(queued).toHaveLength(3); expect(queued.every((event) => JSON.stringify(event.data) === '{"status":"QUEUED"}')).toBe(true);
    await mutateRefundLocally(admin, { action: "confirm-cod", refundId: pending.refund.id, version: pending.refund.version, moneyReturned: true, method: "BANK", reference: "PRIVATE-REFUND-REFERENCE" });
    const succeeded = await mockDatabase.notificationEvent.findMany({ where: { subjectId: order.id, kind: "REFUND_STATUS" } }); expect(succeeded).toHaveLength(6); expect(JSON.stringify(succeeded)).not.toContain("Private customer"); expect(JSON.stringify(succeeded)).not.toContain("PRIVATE-REFUND-REFERENCE");
  });
  it("deduplicates identical source identity and rolls notification capture back with a rejected business transaction", async () => {
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { status: "PENDING_APPROVAL" } }); const event = await mockDatabase.notificationEvent.findFirstOrThrow({ where: { subjectId: products[0].id } });
    await mockDatabase.$executeRaw`SELECT enqueue_notification(${event.dedupeKey},${event.kind},${event.audience},${event.recipientGroup},${event.recipientId},${event.subjectType},${event.subjectId},${JSON.stringify(event.data)}::jsonb)`;
    expect(await mockDatabase.notificationEvent.count({ where: { dedupeKey: event.dedupeKey } })).toBe(1);
    await expect(mockDatabase.$executeRaw`SELECT enqueue_notification(${event.dedupeKey},${event.kind},${event.audience},${event.recipientGroup},${event.recipientId},${event.subjectType},${event.subjectId},'{"status":"FORGED"}'::jsonb)`).rejects.toThrow();
    const before = await mockDatabase.notificationEvent.count({ where: { subjectId: products[0].id } });
    await expect(mockDatabase.$transaction(async (tx) => { await tx.product.update({ where: { id: products[0].id }, data: { status: "APPROVED" } }); throw new Error("Rejected source transaction"); })).rejects.toThrow("Rejected source transaction");
    expect(await mockDatabase.notificationEvent.count({ where: { subjectId: products[0].id } })).toBe(before);
  });
  it("binds delivery to a valid lease/source/recipient and retains message content while accepting versioned read state", async () => {
    await mockDatabase.product.update({ where: { id: products[0].id }, data: { status: "REJECTED" } }); const event = await mockDatabase.notificationEvent.findFirstOrThrow({ where: { subjectId: products[0].id } });
    const payload = { eventId: event.id, userId: seller.id, audience: event.audience, kind: event.kind, title: "Product decision recorded", body: "Review your current product details.", href: "/member/products", occurredAt: event.createdAt };
    await expect(mockDatabase.notification.create({ data: payload })).rejects.toThrow();
    await mockDatabase.notificationEvent.update({ where: { id: event.id }, data: { state: "PROCESSING", version: 2, attempts: 1, claimCount: 1, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) } });
    await expect(mockDatabase.notification.create({ data: { ...payload, userId: other.id } })).rejects.toThrow();
    const delivered = await mockDatabase.notification.create({ data: payload }); await expect(mockDatabase.notification.update({ where: { id: delivered.id }, data: { readVersion: 1, title: "Forged content" } })).rejects.toThrow();
    const read = await mockDatabase.notification.update({ where: { id: delivered.id }, data: { readVersion: 1, readAt: new Date(0) } }); expect(Math.abs(read.readAt!.getTime() - Date.now())).toBeLessThan(10000);
    await expect(mockDatabase.notificationEvent.update({ where: { id: event.id }, data: { version: 3, data: {} } })).rejects.toThrow(); await expect(mockDatabase.notificationEvent.delete({ where: { id: event.id } })).rejects.toThrow(); await expect(mockDatabase.notification.delete({ where: { id: delivered.id } })).rejects.toThrow();
  });
});
