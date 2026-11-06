jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import type { PrismaClient, User, Product, Category } from "@prisma/client";
import { mutateFulfillment, mutateWholeOrder, readSellerFulfillments } from "@/lib/fulfillments";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { readReviewAccess, createVerifiedReview, moderateVerifiedReview, readPublicReviews } from "@/lib/reviews";
import { getCatalogListing } from "@/lib/catalog-listing";
import Stripe from "stripe";
import * as stripeModule from "@/lib/stripe/stripe";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("seller shipment ownership, state and purchase eligibility with actual PostgreSQL", () => {
  let db: PrismaClient, seller: User, secondSeller: User, buyer: User, admin: User, product: Product, secondProduct: Product, category: Category;
  const prefix = `audit-fulfillment-${randomUUID()}`, orders: string[] = [];
  const create = async (paymentMethod = "COD") => {
    const order = await db.order.create({ data: { userId: buyer.id, total: 37.02, status: paymentMethod === "COD" ? "PROCESSING" : "PENDING", paymentMethod, shippingAddress: "Recipient, Test street, Dhaka", shippingPhone: "01700000000", trackingNumber: `AG-${randomUUID()}`, items: { create: [{ productId: product.id, quantity: 2, price: 12.34 }, { productId: secondProduct.id, quantity: 1, price: 12.34 }] } }, include: { fulfillments: true, items: true } });
    orders.push(order.id); return order;
  };
  const ship = (id: string, actor = seller, version = 1) => mutateFulfillment(actor, { fulfillmentId: id, version, action: "ship", carrier: "Actual courier", trackingNumber: `SHIP-${id}` });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    [seller, secondSeller, buyer, admin] = await Promise.all(["seller", "second-seller", "buyer", "admin"].map((name) => db.user.create({ data: { email: `${prefix}-${name}@example.invalid`, role: name === "admin" ? "ADMIN" : name === "buyer" ? "USER" : "MEMBER", isVerified: true, sellerStatus: "APPROVED" } })));
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    [product, secondProduct] = await Promise.all([seller, secondSeller].map((owner, i) => db.product.create({ data: { name: `${prefix}-${i}`, slug: `${prefix}-${i}`, sellerId: owner.id, categoryId: category.id, price: 12.34, stock: 20, status: "APPROVED" } })));
  });
  beforeEach(async () => {
    (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    seller = await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } });
    await db.product.update({ where: { id: product.id }, data: { sellerId: seller.id } });
  });
  afterEach(async () => {
    await db.review.deleteMany({ where: { userId: buyer.id } }); await db.orderItem.deleteMany({ where: { orderId: { in: orders } } }); await db.order.deleteMany({ where: { id: { in: orders } } }); orders.length = 0;
  });
  afterAll(async () => { if (db) { try { if (category) await db.product.deleteMany({ where: { categoryId: category.id } }); if (category) await db.category.delete({ where: { id: category.id } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); } finally { await db.$disconnect(); } } });
  it("returns only the original seller's lines and necessary recipient details after a catalog owner changes", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!;
    await db.product.update({ where: { id: product.id }, data: { sellerId: secondSeller.id } });
    const mine = await readSellerFulfillments(seller); expect(mine.shipments).toHaveLength(1); expect(mine.shipments[0]).toMatchObject({ id: first.id, recipientAddress: "Recipient, Test street, Dhaka", recipientPhone: "01700000000" }); expect(mine.shipments[0].items.map((row) => row.productId)).toEqual([product.id]);
    const text = JSON.stringify(mine); for (const hidden of [buyer.email, buyer.id, secondProduct.id, secondSeller.id]) expect(text).not.toContain(hidden); expect(mine.shipments[0]).not.toHaveProperty("total"); expect(mine.shipments[0]).not.toHaveProperty("user");
    await expect(ship(first.id, secondSeller)).rejects.toMatchObject({ code: "FULFILLMENT_NOT_FOUND" }); expect((await ship(first.id)).shipment.status).toBe("SHIPPED");
  });
  it("ships one seller group, preserves its sibling and records both shipment and aggregate history", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!, second = order.fulfillments.find((row) => row.sellerId === secondSeller.id)!;
    const result = await ship(first.id); expect(result.shipment).toMatchObject({ status: "SHIPPED", version: 2, orderStatus: "PARTIALLY_SHIPPED", carrier: "Actual courier" });
    expect(await db.orderFulfillment.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: "PROCESSING", version: 1, carrier: null });
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } }); expect(saved).toMatchObject({ status: "PARTIALLY_SHIPPED", fulfillmentVersion: 2, shippingCarrier: null, shipmentTrackingNumber: null, paymentStatus: "UNPAID" });
    expect(await db.fulfillmentEvent.findFirst({ where: { fulfillmentId: first.id, kind: "SHIPMENT_SHIPPED" } })).toMatchObject({ actorId: seller.id, actorRole: "MEMBER", status: "SHIPPED" });
    expect(await db.orderEvent.findFirst({ where: { orderId: order.id, fulfillmentId: first.id, kind: "VENDOR_SHIPMENT_SHIPPED" } })).toMatchObject({ fulfillmentStatus: "SHIPPED" });
    await expect(ship(first.id, seller, 1)).rejects.toMatchObject({ code: "FULFILLMENT_CHANGED" });
    const edited = await mutateFulfillment(seller, { fulfillmentId: first.id, version: 2, action: "tracking", carrier: "Updated courier", trackingNumber: "UPDATED-TRACK" }); expect(edited.shipment.version).toBe(3); expect((await db.orderFulfillment.findUniqueOrThrow({ where: { id: second.id } })).trackingNumber).toBeNull();
  });
  it("serializes two vendors on the order while retaining independent group revisions", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!, second = order.fulfillments.find((row) => row.sellerId === secondSeller.id)!;
    const results = await Promise.all([ship(first.id), ship(second.id, secondSeller)]); expect(results).toHaveLength(2); expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED"); expect((await db.orderFulfillment.findMany({ where: { orderId: order.id } })).every((row) => row.status === "SHIPPED" && row.version === 2)).toBe(true);
    const conflict = await Promise.allSettled([mutateFulfillment(seller, { fulfillmentId: first.id, version: 2, action: "tracking", carrier: "Courier one", trackingNumber: "ONE" }), mutateFulfillment(seller, { fulfillmentId: first.id, version: 2, action: "tracking", carrier: "Courier two", trackingNumber: "TWO" })]); expect(conflict.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects unpaid card shipment, revoked/suspended sessions and terminal changes without mutating rows", async () => {
    const card = await create("STRIPE"), pending = card.fulfillments.find((row) => row.sellerId === seller.id)!; await expect(ship(pending.id)).rejects.toMatchObject({ code: "FULFILLMENT_STATE" });
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!;
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); await expect(ship(first.id)).rejects.toMatchObject({ code: "FULFILLMENT_ACCOUNT_CHANGED" }); expect((await db.orderFulfillment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("PROCESSING");
    const suspended = await db.user.findUniqueOrThrow({ where: { id: seller.id } }); await expect(ship(first.id, suspended)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }); await expect(ship(first.id, admin, 2)).rejects.toMatchObject({ code: "FULFILLMENT_STATE" });
  });
  it("rolls back the already-written shipment, revision and audit records when aggregate SQL fails", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!, constraint = `audit_fulfillment_${randomUUID().replaceAll("-", "")}`;
    if (!/^audit_fulfillment_[a-f0-9]{32}$/.test(constraint) || !/^[a-f0-9-]{36}$/.test(order.id)) throw new Error("Invalid fixture SQL identifiers");
    await db.$executeRawUnsafe(`ALTER TABLE "Order" ADD CONSTRAINT "${constraint}" CHECK (id<>'${order.id}' OR status<>'PARTIALLY_SHIPPED')`);
    try { await expect(ship(first.id)).rejects.toThrow(); expect(await db.orderFulfillment.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "PROCESSING", version: 1, carrier: null }); expect(await db.fulfillmentEvent.count({ where: { fulfillmentId: first.id } })).toBe(1); }
    finally { await db.$executeRawUnsafe(`ALTER TABLE "Order" DROP CONSTRAINT "${constraint}"`); }
  });
  it("qualifies only a delivered and collected item in a partial COD order for reviews and bestseller units", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!;
    await db.$transaction(async (tx) => {
      await tx.orderFulfillment.update({ where: { id: first.id }, data: { status: "DELIVERED", deliveredAt: new Date(), codCollected: true, codCollectedAt: new Date(), version: { increment: 1 } } });
      await tx.order.update({ where: { id: order.id }, data: { status: "PARTIALLY_DELIVERED" } });
    });
    expect((await readReviewAccess(buyer, product.id)).eligible).toBe(true); expect((await readReviewAccess(buyer, secondProduct.id)).eligible).toBe(false);
    const review = await createVerifiedReview(buyer, { productId: product.id, rating: 4, comment: "This seller's actual package arrived and was paid." }); await moderateVerifiedReview(admin, { id: review.id, version: review.version, action: "publish" }); expect((await readPublicReviews(product.id)).total).toBe(1); expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).rating).toBe(4);
    const listing = await getCatalogListing({ category: category.slug, sort: "bestsellers" }); expect(listing.products[0].id).toBe(product.id); expect(listing.products[0].unitsSold).toBe("2");
  });
  it("requires an administrator's explicit COD confirmation for each delivery and pays the order only after all shipments are collected", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!, second = order.fulfillments.find((row) => row.sellerId === secondSeller.id)!;
    const deliver = (id: string, version: number, actor = admin, codMoneyReceived = true) => mutateFulfillment(actor, { fulfillmentId: id, version, action: "deliver", codMoneyReceived });
    await expect(deliver(first.id, 1)).rejects.toMatchObject({ code: "FULFILLMENT_STATE" });
    await ship(first.id); await ship(second.id, secondSeller);
    await expect(deliver(first.id, 2, seller)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deliver(first.id, 2, admin, false)).rejects.toMatchObject({ code: "FULFILLMENT_COD_CONFIRMATION" });
    expect((await db.orderFulfillment.findUniqueOrThrow({ where: { id: first.id } })).version).toBe(2);
    const delivered = await deliver(first.id, 2); expect(delivered.shipment).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID", orderStatus: "PARTIALLY_DELIVERED", version: 3 }); expect(delivered.shipment.codCollectedAt).toBeTruthy();
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PARTIALLY_DELIVERED", paymentStatus: "UNPAID" });
    expect(await db.orderFulfillment.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: "SHIPPED", codCollected: false });
    await expect(deliver(first.id, 2)).rejects.toMatchObject({ code: "FULFILLMENT_CHANGED" });
    expect((await readReviewAccess(buyer, product.id)).eligible).toBe(true); expect((await readReviewAccess(buyer, secondProduct.id)).eligible).toBe(false);
    await deliver(second.id, 2);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    expect(await db.fulfillmentEvent.findFirst({ where: { fulfillmentId: first.id, kind: "SHIPMENT_DELIVERED" } })).toMatchObject({ actorId: admin.id, actorRole: "ADMIN", codCollected: true });
    await expect(deliver(first.id, 3)).rejects.toMatchObject({ code: "FULFILLMENT_STATE" });
  });
  it("keeps Stripe delivery bound to verified card payment and refuses a COD assertion on a card shipment", async () => {
    const order = await create("STRIPE"), first = order.fulfillments.find((row) => row.sellerId === seller.id)!;
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID", status: "PROCESSING" } });
    await ship(first.id, seller, 2);
    await expect(mutateFulfillment(admin, { fulfillmentId: first.id, version: 3, action: "deliver", codMoneyReceived: true })).rejects.toMatchObject({ code: "FULFILLMENT_PAYMENT" });
    const saved = await mutateFulfillment(admin, { fulfillmentId: first.id, version: 3, action: "deliver", codMoneyReceived: false }); expect(saved.shipment).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID", codCollectedAt: null });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PARTIALLY_DELIVERED", paymentStatus: "PAID" });
  });
  it("restores every reserved COD unit exactly once under concurrent cancellation and rejects a stale/admin-revoked request", async () => {
    const order = await create(), before = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    const input = { orderId: order.id, ownerId: admin.id, version: 1, action: "cancel" };
    const results = await Promise.allSettled([mutateWholeOrder(admin, input), mutateWholeOrder(admin, input)]); expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(before.stock + 2);
    expect((await db.orderFulfillment.findMany({ where: { orderId: order.id } })).every((row) => row.status === "CANCELLED")).toBe(true);
    const another = await create(), group = another.fulfillments.find((row) => row.sellerId === seller.id)!;
    await ship(group.id); await expect(mutateWholeOrder(admin, { ...input, orderId: another.id, version: 2 })).rejects.toMatchObject({ code: "FULFILLMENT_STATE" });
    const fresh = await create(); await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    try { await expect(mutateWholeOrder(admin, { ...input, orderId: fresh.id })).rejects.toMatchObject({ code: "FULFILLMENT_ACCOUNT_CHANGED" }); expect((await db.order.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("PROCESSING"); }
    finally { admin = await db.user.findUniqueOrThrow({ where: { id: admin.id } }); }
  });
  it("gives concurrent seller shipping and administrator cancellation one valid winner with matching inventory", async () => {
    for (const cancelFirst of [false, true]) {
      const order = await create(), group = order.fulfillments.find((row) => row.sellerId === seller.id)!, stock = (await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
      const cancel = () => mutateWholeOrder(admin, { orderId: order.id, ownerId: admin.id, version: 1, action: "cancel" });
      const results = await Promise.allSettled(cancelFirst ? [cancel(), ship(group.id)] : [ship(group.id), cancel()]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } }), shipment = await db.orderFulfillment.findUniqueOrThrow({ where: { id: group.id } });
      expect(["CANCELLED", "PARTIALLY_SHIPPED"]).toContain(saved.status); expect(shipment.status).toBe(saved.status === "CANCELLED" ? "CANCELLED" : "SHIPPED");
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(stock + (saved.status === "CANCELLED" ? 2 : 0));
    }
  });
  it("enforces private route ownership, role, strict inputs, body bounds, history isolation and rate limits", async () => {
    const memberApi = await import("@/app/api/member/fulfillments/route"), adminApi = await import("@/app/api/admin/fulfillments/route"), historyApi = await import("@/app/api/fulfillments/[id]/history/route");
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!, second = order.fulfillments.find((row) => row.sellerId === secondSeller.id)!;
    const request = (path = "/api/member/fulfillments", method = "GET", body?: unknown, ownerId: string | null = seller.id) => new Request(`http://localhost${path}`, { method, headers: ownerId ? { "X-Fulfillment-Owner": ownerId } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    (getCurrentUser as jest.Mock).mockResolvedValue(null); expect((await memberApi.GET(request())).status).toBe(401);
    (getCurrentUser as jest.Mock).mockResolvedValue(seller); expect((await memberApi.GET(request(undefined, "GET", undefined, null))).status).toBe(409);
    expect((await adminApi.GET(request("/api/admin/fulfillments"))).status).toBe(403);
    const list = await memberApi.GET(request()); expect(list.headers.get("cache-control")).toBe("private, no-store"); expect((await list.json()).shipments.map((row: { id: string }) => row.id)).toEqual([first.id]);
    expect((await memberApi.GET(request("/api/member/fulfillments?page=1&page=2"))).status).toBe(400);
    expect((await memberApi.GET(request("/api/member/fulfillments?status=ALL&sellerId=foreign"))).status).toBe(400);
    expect((await memberApi.GET(request("/api/member/fulfillments?page=2"))).status).toBe(404);
    const mutation = { fulfillmentId: first.id, version: 1, action: "ship", carrier: "Courier", trackingNumber: "TRACK" };
    expect((await memberApi.POST(request(undefined, "POST", { ...mutation, sellerId: seller.id }))).status).toBe(400);
    expect((await memberApi.POST(request(undefined, "POST", { ...mutation, fulfillmentId: second.id }))).status).toBe(404);
    expect((await memberApi.POST(request(undefined, "POST", { ...mutation, carrier: "x".repeat(17000) }))).status).toBe(413);
    expect((await memberApi.POST(request(undefined, "POST", { fulfillmentId: first.id, version: 1, action: "deliver", codMoneyReceived: true }))).status).toBe(403);
    const saved = await memberApi.POST(request(undefined, "POST", mutation)); expect(saved.status).toBe(200);
    expect((await memberApi.POST(request(undefined, "POST", mutation))).status).toBe(409);
    expect((await historyApi.GET(request(), { params: Promise.resolve({ id: second.id }) })).status).toBe(404);
    const foreignCursor = await db.fulfillmentEvent.findFirstOrThrow({ where: { fulfillmentId: second.id } });
    expect((await historyApi.GET(request(`/api/fulfillments/${first.id}/history?cursor=${foreignCursor.id}`), { params: Promise.resolve({ id: first.id }) })).status).toBe(404);
    const history = await historyApi.GET(request(), { params: Promise.resolve({ id: first.id }) }); const events = (await history.json()).events; expect(events).toHaveLength(2); expect(events[1]).not.toHaveProperty("actorId");
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); const limited = await memberApi.GET(request()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
  });
  it("records UTC shipment and aggregate instants even when the database session uses Dhaka time", async () => {
    const order = await create(), first = order.fulfillments.find((row) => row.sellerId === seller.id)!, start = Date.now();
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Dhaka'");
      await tx.orderFulfillment.update({ where: { id: first.id }, data: { status: "SHIPPED", carrier: "Courier", trackingNumber: "UTC-TRACK", shippedAt: new Date(), version: { increment: 1 } } });
      await tx.order.update({ where: { id: order.id }, data: { status: "PARTIALLY_SHIPPED" } });
    });
    const events = await db.orderEvent.findMany({ where: { orderId: order.id, kind: { in: ["STATE_CHANGED", "VENDOR_SHIPMENT_SHIPPED"] } } }); expect(events).toHaveLength(2);
    for (const event of events) { expect(event.occurredAt!.getTime()).toBeGreaterThanOrEqual(start - 100); expect(event.occurredAt!.getTime()).toBeLessThanOrEqual(Date.now() + 100); }
  });
  it("rechecks administrator revocation after provider expiry before releasing any card stock", async () => {
    const order = await create("STRIPE"), stock = (await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
    await db.order.update({ where: { id: order.id }, data: { stripeSessionRequestedAt: new Date(), stripeCheckoutSessionId: "cs_guarded_cancel", reservationExpiresAt: new Date(Date.now() - 1000) } });
    const stripe = new Stripe("sk_test_isolated_cancellation_fixture"), provider = jest.spyOn(stripeModule, "getStripe").mockReturnValue(stripe);
    const session = { id: "cs_guarded_cancel", metadata: { orderId: order.id }, payment_status: "unpaid", status: "open" } as unknown as Stripe.Checkout.Session;
    const retrieve = jest.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(session as never);
    const expire = jest.spyOn(stripe.checkout.sessions, "expire").mockImplementation(async () => { await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } }); return { ...session, status: "expired" } as never; });
    try {
      await expect(mutateWholeOrder(admin, { orderId: order.id, ownerId: admin.id, version: 1, action: "cancel" })).rejects.toMatchObject({ code: "FULFILLMENT_ACCOUNT_CHANGED" });
      expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PENDING", paymentStatus: "UNPAID" });
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(stock);
    } finally { retrieve.mockRestore(); expire.mockRestore(); provider.mockRestore(); admin = await db.user.findUniqueOrThrow({ where: { id: admin.id } }); }
  });
  it("records newly confirmed money on a legacy delivered COD shipment without inventing its delivery time", async () => {
    const order = await db.order.create({ data: { userId: buyer.id, status: "DELIVERED", paymentMethod: "COD", paymentStatus: "UNPAID", total: 12.34, items: { create: { productId: product.id, quantity: 1, price: 12.34 } } }, include: { fulfillments: true } }); orders.push(order.id);
    const group = order.fulfillments[0]; expect(group).toMatchObject({ legacySnapshot: true, deliveredAt: null, codCollected: false });
    await expect(mutateFulfillment(seller, { fulfillmentId: group.id, version: 1, action: "collect-cod", codMoneyReceived: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await mutateFulfillment(admin, { fulfillmentId: group.id, version: 1, action: "collect-cod", codMoneyReceived: true }); expect(result.shipment).toMatchObject({ paymentStatus: "PAID", deliveredAt: null, legacySnapshot: true }); expect(result.shipment.codCollectedAt).toBeTruthy();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
    expect(await db.fulfillmentEvent.findFirst({ where: { fulfillmentId: group.id, kind: "COD_COLLECTED" } })).toMatchObject({ actorId: admin.id, actorRole: "ADMIN" });
  });
});
