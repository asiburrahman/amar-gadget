jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(), getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: jest.fn(), set: jest.fn() }), headers: jest.fn().mockResolvedValue(new Headers()) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient, User, Category, Product } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import * as api from "@/app/api/cart/route";
import { POST as guestResolve } from "@/app/api/cart/guest/route";
import { POST as receiptLookup } from "@/app/api/checkout/attempt/route";
import { POST as checkoutAction } from "@/app/api/checkout/[orderId]/route";
import { createOrder } from "@/server/actions/order/order-actions";
import * as cartService from "@/lib/cart";
import { releaseReservation } from "@/lib/checkout-reservations";
import { getStripe } from "@/lib/stripe/stripe";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import type { AccountCartSnapshot, CartCheckoutContext, CartMutation } from "@/lib/validations/cart";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("cart persistence and checkout line identity with actual PostgreSQL", () => {
  let db: PrismaClient, owner: User, other: User, seller: User, category: Category, products: Product[];
  const prefix = `audit-cart-${randomUUID()}`, guestUsers: string[] = [];
  const request = (method = "GET", body?: unknown, id = owner.id, query = "") => new Request(`http://localhost/api/cart${query}`, { method, headers: { "X-Cart-Owner": id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const read = async (): Promise<AccountCartSnapshot> => { const response = await api.GET(request()); expect(response.status).toBe(200); return response.json(); };
  const change = (input: CartMutation) => api.POST(request("POST", input));
  const setLine = async (product = products[0], quantity = 3) => {
    const snapshot = await read(), existing = snapshot.lines.find((line) => line.id === product.id);
    const response = await change({ action: "set", productId: product.id, quantity, lineId: existing?.lineId ?? null, version: snapshot.version, requestId: randomUUID() });
    expect(response.status).toBe(200); return read();
  };
  const context = (snapshot: AccountCartSnapshot, quantity?: number): CartCheckoutContext => ({
    ownerId: owner.id, sourceId: null, version: snapshot.version, couponCode: snapshot.couponCode, couponVersion: snapshot.couponVersion,
    lines: snapshot.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: quantity ?? line.quantity })),
  });
  const checkout = (cart: CartCheckoutContext, method: "COD" | "STRIPE" = "COD") => ({
    cart, items: cart.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })), checkoutToken: randomBytes(32).toString("hex"), fullName: "Cart recipient", phone: "01700000000", street: "Cart fixture road", city: "Dhaka", district: "Dhaka", paymentMethod: method, couponCode: cart.couponCode ?? undefined,
  });
  const stripeOrder = async (quantity = 1) => {
    const snapshot = await setLine(products[0], 3), input = checkout(context(snapshot, quantity), "STRIPE"), result = await createOrder(input);
    expect(result.success).toBe(true); if (!result.success) throw new Error("Cart checkout was not saved"); return { snapshot, input, orderId: result.orderId };
  };
  const guestContext = (): CartCheckoutContext => ({ ownerId: null, sourceId: randomUUID(), version: 1, couponCode: null, couponVersion: 0, previousReceiptId: null, lines: [{ productId: products[0].id, lineId: randomUUID(), quantity: 1 }] });
  const createGuestOrder = async (input: ReturnType<typeof checkout>) => {
    const result = await createOrder(input);
    if (result.success) guestUsers.push((await db.order.findUniqueOrThrow({ where: { id: result.orderId } })).userId);
    return result;
  };
  const ack = (orderId: string) => checkoutAction(new Request(`http://localhost/api/checkout/${orderId}`, { method: "POST", body: JSON.stringify({ action: "ack-cart" }) }), { params: Promise.resolve({ orderId }) });
  const lookup = (input: { checkoutToken: string; ownerId: string | null; sourceId: string | null }) => receiptLookup(new Request("http://localhost/api/checkout/attempt", { method: "POST", body: JSON.stringify(input) }));
  const paidEvent = async (orderId: string) => {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type: "checkout.session.completed", data: { object: { id: `cs_cart_${orderId}`, metadata: { orderId }, status: "complete", payment_status: "paid", amount_total: Math.round(Number(order.total) * 100), currency: "bdt", payment_intent: `pi_cart_${orderId}` } } });
    const signature = getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    return webhook(new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
  };
  const clearFixtures = async () => {
    const ids = [owner.id, other.id, ...guestUsers];
    await db.orderItem.deleteMany({ where: { order: { userId: { in: ids } } } });
    await db.order.deleteMany({ where: { userId: { in: ids } } });
    await db.cart.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
  };
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    await db.product.createMany({ data: Array.from({ length: 102 }, (_, index) => ({ name: `${prefix}-${index}`, slug: `${prefix}-${index}`, price: 100, discountPrice: 80, stock: 100, status: "APPROVED", sellerId: seller.id, categoryId: category.id })) });
    products = await db.product.findMany({ where: { sellerId: seller.id }, orderBy: { slug: "asc" } });
    process.env.STRIPE_SECRET_KEY = "sk_test_local_cart_fixture"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_cart_fixture";
  });
  beforeEach(async () => {
    await clearFixtures(); owner = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    await db.product.updateMany({ where: { sellerId: seller.id }, data: { stock: 100, status: "APPROVED", price: 100, discountPrice: 80, imageUrl: null } });
    (getCurrentUser as jest.Mock).mockResolvedValue(owner); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    (cookies as jest.Mock).mockResolvedValue({ get: jest.fn(), set: jest.fn() }); (revalidatePath as jest.Mock).mockReset();
  });
  afterAll(async () => { if (db) try {
    if (owner && other) await clearFixtures();
    if (seller) await db.product.deleteMany({ where: { sellerId: seller.id } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.coupon.deleteMany({ where: { code: { startsWith: prefix.toUpperCase() } } });
    await db.user.deleteMany({ where: { OR: [{ email: { startsWith: prefix } }, { id: { in: guestUsers } }] } });
  } finally { await db.$disconnect(); } });

  it("creates an owned empty cart, serves real stock/price and confirms an immediate retry without adding twice", async () => {
    const empty = await read(); expect(empty).toMatchObject({ ownerId: owner.id, version: 0, lines: [], couponCode: null });
    const input: CartMutation = { action: "set", productId: products[0].id, lineId: null, quantity: 2, version: 0, requestId: randomUUID() };
    expect((await change(input)).status).toBe(200); expect((await change(input)).status).toBe(200);
    const saved = await read(); expect(saved.version).toBe(1); expect(saved.lines[0]).toMatchObject({ quantity: 2, product: { price: 100, discountPrice: 80, stock: 100 } });
    expect((await change({ ...input, quantity: 3 })).status).toBe(409); expect((await read()).lines[0].quantity).toBe(2);
    expect((await api.GET(request())).headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects stale concurrent edits visibly and never overwrites a newer cart after an intervening operation", async () => {
    const requests: CartMutation[] = products.slice(0, 2).map((product) => ({ action: "set", productId: product.id, lineId: null, quantity: 1, version: 0, requestId: randomUUID() }));
    const responses = await Promise.all(requests.map(change)); expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const first = await read(); const winner = responses.findIndex((response) => response.status === 200), loser = 1 - winner;
    expect((await change({ ...requests[loser], version: first.version, requestId: randomUUID() })).status).toBe(200);
    expect((await change(requests[winner])).status).toBe(409); expect((await read()).lines).toHaveLength(2);
  });
  it("isolates actual owners and guards stale queued request headers and line identities", async () => {
    const saved = await setLine(); (getCurrentUser as jest.Mock).mockResolvedValue(other);
    expect((await api.GET(request())).status).toBe(409);
    expect((await api.POST(request("POST", { action: "clear", version: saved.version, requestId: randomUUID() }))).status).toBe(409);
    const foreign = await api.POST(request("POST", { action: "remove", lineId: saved.lines[0].lineId, version: 0, requestId: randomUUID() }, other.id)); expect(foreign.status).toBe(200);
    expect(await db.cartLine.count({ where: { cartUserId: owner.id } })).toBe(1); expect(await db.cartLine.count({ where: { cartUserId: other.id } })).toBe(0);
  });
  it("merges using the larger quantity, skips unavailable entries and preserves the account coupon", async () => {
    const current = await setLine(products[0], 2);
    await change({ action: "coupon", code: "ACCOUNT-CODE", version: current.version, requestId: randomUUID() });
    await db.product.update({ where: { id: products[1].id }, data: { status: "PENDING_APPROVAL" } });
    let snapshot = await read();
    const input: CartMutation = { action: "merge", items: [{ productId: products[0].id, quantity: 3 }, { productId: products[1].id, quantity: 1 }], version: snapshot.version, requestId: randomUUID() };
    const response = await change(input); expect(response.status).toBe(200); expect((await response.json()).skippedIds).toEqual([products[1].id]);
    snapshot = await read(); expect(snapshot.lines[0].quantity).toBe(3); expect(snapshot.couponCode).toBe("ACCOUNT-CODE");
    expect((await change({ ...input, version: snapshot.version, requestId: randomUUID() })).status).toBe(200); expect((await read()).lines[0].quantity).toBe(3);
  });
  it("refreshes unavailable metadata, refuses stock increases and allows decreasing/removing retained lines", async () => {
    let snapshot = await setLine(products[0], 3);
    await db.product.update({ where: { id: products[0].id }, data: { stock: 0 } }); snapshot = await read(); expect(snapshot.lines[0].product?.stock).toBe(0);
    expect((await change({ action: "set", productId: products[0].id, lineId: snapshot.lines[0].lineId, quantity: 4, version: snapshot.version, requestId: randomUUID() })).status).toBe(409);
    snapshot = await setLine(products[0], 2); expect(snapshot.lines[0].quantity).toBe(2);
    await db.product.update({ where: { id: products[0].id }, data: { status: "REJECTED" } }); snapshot = await read(); expect(snapshot.lines[0].product).toBeNull(); expect(JSON.stringify(snapshot)).not.toContain(products[0].name);
    expect((await change({ action: "remove", lineId: snapshot.lines[0].lineId, version: snapshot.version, requestId: randomUUID() })).status).toBe(200);
  });
  it("keeps deleted product references removable without catalog deletion mutating cart identity/version", async () => {
    const extra = await db.product.create({ data: { name: `${prefix}-deleted`, slug: `${prefix}-deleted`, price: 100, stock: 1, status: "APPROVED", sellerId: seller.id, categoryId: category.id } });
    const snapshot = await setLine(extra, 1); await db.product.delete({ where: { id: extra.id } }); const after = await read(); expect(after.version).toBe(snapshot.version); expect(after.lines[0].product).toBeNull();
    expect((await change({ action: "remove", lineId: after.lines[0].lineId, version: after.version, requestId: randomUUID() })).status).toBe(200);
  });
  it("rejects mass assignment, malformed/oversized inputs, revoked sessions and rate exhaustion", async () => {
    for (const changes of [{ quantity: 0 }, { quantity: 1.2 }, { quantity: 101 }, { price: 1 }, { ownerId: other.id }, { version: -1 }]) {
      expect((await api.POST(request("POST", { action: "set", productId: products[0].id, quantity: 1, lineId: null, version: 0, requestId: randomUUID(), ...changes }))).status).toBe(400);
    }
    expect((await api.POST(new Request("http://localhost/api/cart", { method: "POST", headers: { "X-Cart-Owner": owner.id }, body: "x".repeat(16_385) }))).status).toBe(413);
    expect((await api.GET(request("GET", undefined, owner.id, "?owner=other"))).status).toBe(400);
    (getCurrentUser as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(401);
    (getCurrentUser as jest.Mock).mockResolvedValue(owner); await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } }); expect((await api.GET(request())).status).toBe(409);
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); const limited = await api.GET(request()); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
  });
  it("resolves guest catalog values without accepting cached prices or touching account cart storage", async () => {
    const body = { lines: [{ productId: products[0].id, lineId: randomUUID(), quantity: 2 }] };
    const response = await guestResolve(new Request("http://localhost/api/cart/guest", { method: "POST", body: JSON.stringify(body) })); expect(response.status).toBe(200); expect((await response.json()).lines[0].product).toMatchObject({ price: 100, discountPrice: 80, stock: 100 });
    expect((await guestResolve(new Request("http://localhost/api/cart/guest", { method: "POST", body: JSON.stringify({ ...body, price: 1 }) }))).status).toBe(400);
    expect(await db.cart.count({ where: { userId: owner.id } })).toBe(0);
  });
  it("binds and atomically consumes only purchased COD quantities and replays the same order without another subtraction", async () => {
    const snapshot = await setLine(), input = checkout(context(snapshot, 1));
    const first = await createOrder(input); expect(first.success).toBe(true); if (!first.success) throw new Error("Order not created");
    expect((await read()).lines[0].quantity).toBe(2); const order = await db.order.findUniqueOrThrow({ where: { id: first.orderId } }); expect(order.cartConsumedAt).not.toBeNull(); expect(Number(order.total)).toBe(230);
    const recent = (await read()).recentCheckout; expect(recent).toMatchObject({ id: first.orderId, status: "PROCESSING", paymentStatus: "UNPAID", paymentMethod: "COD" }); expect(JSON.stringify(recent)).not.toContain("Cart recipient");
    expect(await createOrder(input)).toMatchObject({ success: true, orderId: first.orderId }); expect((await read()).lines[0].quantity).toBe(2);
  });
  it("rejects stale/foreign context and missing context for a populated account cart before stock/order writes", async () => {
    const snapshot = await setLine(), input = checkout(context(snapshot, 1)); const before = await db.order.count({ where: { userId: owner.id } });
    for (const changed of [{ ...input, cart: { ...input.cart, ownerId: other.id } }, { ...input, cart: { ...input.cart, version: input.cart.version + 1 } }, { ...input, cart: undefined }]) expect((await createOrder(changed)).success).toBe(false);
    expect(await db.order.count({ where: { userId: owner.id } })).toBe(before); expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(100);
  });
  it("exposes one resumable account checkout and consumes on a real signed Stripe event exactly once, preserving extra quantities", async () => {
    const reserved = await stripeOrder(); const pending = await read(); expect(Object.keys(pending.pendingCheckouts)).toEqual([reserved.orderId]); expect(pending.lines[0].quantity).toBe(3);
    const duplicate = await createOrder({ ...reserved.input, checkoutToken: randomBytes(32).toString("hex") }); expect(duplicate).toMatchObject({ success: false, code: "CART_HAS_PENDING", resumeOrderId: reserved.orderId });
    await setLine(products[0], 4); expect((await paidEvent(reserved.orderId)).status).toBe(200); expect((await read()).lines[0].quantity).toBe(3); expect(Object.keys((await read()).pendingCheckouts)).toEqual([]);
    expect((await paidEvent(reserved.orderId)).status).toBe(200); expect((await read()).lines[0].quantity).toBe(3);
  });
  it("never removes a replacement line when a reserved order's payment arrives later", async () => {
    const reserved = await stripeOrder(), snapshot = await read(), oldId = snapshot.lines[0].lineId;
    await change({ action: "remove", lineId: oldId, version: snapshot.version, requestId: randomUUID() }); const replacement = await setLine(products[0], 2); expect(replacement.lines[0].lineId).not.toBe(oldId);
    expect((await paidEvent(reserved.orderId)).status).toBe(200); expect((await read()).lines[0].quantity).toBe(2); expect((await read()).lines[0].lineId).toBe(replacement.lines[0].lineId);
  });
  it("retains cart quantities for cancellation and late payment that requires refund review", async () => {
    const reserved = await stripeOrder(); await db.order.update({ where: { id: reserved.orderId }, data: { reservationExpiresAt: new Date(0) } });
    expect(await releaseReservation(reserved.orderId, { noSessionBefore: new Date() })).toBe(true); expect((await read()).lines[0].quantity).toBe(3);
    expect((await paidEvent(reserved.orderId)).status).toBe(200); const order = await db.order.findUniqueOrThrow({ where: { id: reserved.orderId } }); expect(order.status).toBe("CANCELLED"); expect(order.cartConsumedAt).toBeNull(); expect((await read()).lines[0].quantity).toBe(3);
  });
  it("preserves a re-applied coupon intent even when its text matches the reserved order", async () => {
    let snapshot = await setLine(); const coupon = await db.coupon.create({ data: { code: `${prefix}-COUPON`.toUpperCase(), discount: 5, isPercentage: false, isActive: true } });
    await change({ action: "coupon", code: coupon.code, version: snapshot.version, requestId: randomUUID() }); snapshot = await read();
    const result = await createOrder(checkout(context(snapshot, 1), "STRIPE")); expect(result.success).toBe(true); if (!result.success) throw new Error("Order missing");
    await change({ action: "coupon", code: coupon.code, version: snapshot.version, requestId: randomUUID() }); expect((await paidEvent(result.orderId)).status).toBe(200);
    const after = await read(); expect(after.couponCode).toBe(coupon.code); expect(after.couponVersion).toBe(snapshot.couponVersion + 1); expect(after.lines[0].quantity).toBe(2);
  });
  it("keeps guest receipt ownership separate from an authenticated cart", async () => {
    const snapshot = await setLine(); (getCurrentUser as jest.Mock).mockResolvedValue(null);
    const guest: CartCheckoutContext = { ownerId: null, sourceId: randomUUID(), version: 0, couponVersion: 0, couponCode: null, lines: [{ productId: products[0].id, lineId: randomUUID(), quantity: 1 }] };
    const result = await createOrder(checkout(guest)); expect(result.success).toBe(true); if (!result.success) throw new Error("Guest order missing");
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } }); guestUsers.push(order.userId); expect(order.cartConsumedAt).not.toBeNull();
    (getCurrentUser as jest.Mock).mockResolvedValue(owner); expect((await read()).lines[0].quantity).toBe(snapshot.lines[0].quantity);
  });
  it("serializes payment consumption against a real competing cart edit", async () => {
    const reserved = await stripeOrder(); let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { arrived = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const realLock = cartService.lockCartOwner;
    const spy = jest.spyOn(cartService, "lockCartOwner").mockImplementationOnce(async (tx, id, create) => { const cart = await realLock(tx, id, create); arrived(); await gate; return cart; });
    const payment = paidEvent(reserved.orderId); let edit: Promise<Response> | undefined;
    try {
      await entered; edit = change({ action: "set", productId: products[0].id, lineId: reserved.snapshot.lines[0].lineId, quantity: 4, version: reserved.snapshot.version, requestId: randomUUID() });
      let waiting = false; const deadline = Date.now() + 2000;
      while (Date.now() < deadline) { const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM "User"%'`; if (Number(row.total)) { waiting = true; break; } await delay(10); }
      expect(waiting).toBe(true); release(); expect((await payment).status).toBe(200); expect((await edit).status).toBe(409); expect((await read()).lines[0].quantity).toBe(2);
    } finally { release(); await payment; await edit; spy.mockRestore(); }
  });
  it("serializes different guest attempt tokens for one source without creating a second order or guest identity", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null); const cart = guestContext(), first = checkout(cart), second = checkout(cart);
    const results = await Promise.all([createGuestOrder(first), createGuestOrder(second)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)).toMatchObject({ code: "CART_GUEST_REVIEW" });
    expect(await db.order.count({ where: { cartSnapshot: { path: ["sourceId"], equals: cart.sourceId! } } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(99);
    const failed = results.find((result) => !result.success)!; expect(JSON.stringify(failed)).not.toContain("orderId");
  });
  it("requires an authorized acknowledgement and advancing receipt/version before another guest checkout", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null); const cart = guestContext(), input = checkout(cart), first = await createGuestOrder(input);
    expect(first.success).toBe(true); if (!first.success) throw new Error("Guest order missing");
    const advanced = { ...cart, version: cart.version + 1, previousReceiptId: first.orderId };
    expect(await createGuestOrder(checkout(advanced))).toMatchObject({ success: false, code: "CART_GUEST_REVIEW" });
    expect((await ack(first.orderId)).status).toBe(404);
    (cookies as jest.Mock).mockResolvedValue({ get: () => ({ value: input.checkoutToken }), set: jest.fn() });
    (getCurrentUser as jest.Mock).mockResolvedValue(other); expect((await ack(first.orderId)).status).toBe(404);
    expect((await db.order.findUniqueOrThrow({ where: { id: first.orderId } })).cartAcknowledgedAt).toBeNull();
    (getCurrentUser as jest.Mock).mockResolvedValue(null); expect((await ack(first.orderId)).status).toBe(200);
    const acknowledged = (await db.order.findUniqueOrThrow({ where: { id: first.orderId } })).cartAcknowledgedAt; expect(acknowledged).not.toBeNull();
    expect((await ack(first.orderId)).status).toBe(200); expect((await db.order.findUniqueOrThrow({ where: { id: first.orderId } })).cartAcknowledgedAt).toEqual(acknowledged);
    for (const invalid of [{ ...advanced, previousReceiptId: null }, { ...advanced, previousReceiptId: randomUUID() }, { ...advanced, version: cart.version }]) {
      expect(await createGuestOrder(checkout(invalid))).toMatchObject({ success: false, code: "CART_GUEST_REVIEW" });
    }
    const nextOrder = await createGuestOrder(checkout(advanced)); expect(nextOrder.success).toBe(true);
    expect(await createOrder(input)).toMatchObject({ success: true, orderId: first.orderId });
  });
  it("does not acknowledge unpaid Stripe intent, but permits a verified payment or closed reservation", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null); const input = checkout(guestContext(), "STRIPE"), result = await createGuestOrder(input);
    expect(result.success).toBe(true); if (!result.success) throw new Error("Guest order missing");
    (cookies as jest.Mock).mockResolvedValue({ get: () => ({ value: input.checkoutToken }), set: jest.fn() });
    const pending = await ack(result.orderId); expect(pending.status).toBe(409); expect(await pending.json()).toMatchObject({ code: "CART_STILL_PENDING" });
    expect((await db.order.findUniqueOrThrow({ where: { id: result.orderId } })).cartAcknowledgedAt).toBeNull();
    expect((await paidEvent(result.orderId)).status).toBe(200); expect((await ack(result.orderId)).status).toBe(200);
    const cancelledInput = checkout(guestContext(), "STRIPE"), cancelled = await createGuestOrder(cancelledInput);
    expect(cancelled.success).toBe(true); if (!cancelled.success) throw new Error("Second guest order missing");
    await db.order.update({ where: { id: cancelled.orderId }, data: { reservationExpiresAt: new Date(0) } });
    expect(await releaseReservation(cancelled.orderId, { noSessionBefore: new Date() })).toBe(true);
    (cookies as jest.Mock).mockResolvedValue({ get: () => ({ value: cancelledInput.checkoutToken }), set: jest.fn() });
    expect((await ack(cancelled.orderId)).status).toBe(200); expect((await paidEvent(cancelled.orderId)).status).toBe(200);
    const late = await db.order.findUniqueOrThrow({ where: { id: cancelled.orderId } }); expect(late.status).toBe("CANCELLED"); expect(late.cartConsumedAt).toBeNull(); expect(late.cartAcknowledgedAt).not.toBeNull();
  });
  it("recovers only with the original strong secret and actual owner/source, renewing scoped HttpOnly receipt cookies", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null); const cart = guestContext(), input = checkout(cart), result = await createGuestOrder(input);
    expect(result.success).toBe(true); if (!result.success) throw new Error("Guest order missing");
    const body = { checkoutToken: input.checkoutToken, ownerId: null, sourceId: cart.sourceId };
    expect((await lookup({ ...body, checkoutToken: randomBytes(32).toString("hex") })).status).toBe(404);
    expect((await lookup({ ...body, sourceId: randomUUID() })).status).toBe(404);
    (getCurrentUser as jest.Mock).mockResolvedValue(other); expect((await lookup(body)).status).toBe(409);
    (getCurrentUser as jest.Mock).mockResolvedValue(null); const recovered = await lookup(body); expect(recovered.status).toBe(200);
    const data = await recovered.json(); expect(data.order).toMatchObject({ id: result.orderId, status: "PROCESSING", paymentStatus: "UNPAID", cartSnapshot: cart });
    for (const forbidden of [input.fullName, input.street, input.phone, input.checkoutToken, "checkoutTokenHash"]) expect(JSON.stringify(data)).not.toContain(forbidden);
    expect(recovered.headers.get("cache-control")).toBe("private, no-store");
    const cookieHeader = recovered.headers.get("set-cookie")!; expect(cookieHeader).toContain(`Path=/order-success/${result.orderId}`); expect(cookieHeader).toContain(`Path=/api/checkout/${result.orderId}`); expect(cookieHeader).toContain("HttpOnly"); expect(cookieHeader).toContain("SameSite=lax");
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); expect((await lookup(body)).status).toBe(429);
    (rateLimit as jest.Mock).mockResolvedValue({ success: true });
    const oversized = await receiptLookup(new Request("http://localhost/api/checkout/attempt", { method: "POST", body: "x".repeat(1025) })); expect(oversized.status).toBe(413);
  });
  it("keeps committed order success after response-cookie/cache failures and recovers without double stock consumption", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null); const cart = guestContext(), input = checkout(cart);
    (revalidatePath as jest.Mock).mockImplementationOnce(() => { throw new Error("Cache backend unavailable"); });
    (cookies as jest.Mock).mockRejectedValueOnce(new Error("Response cookie unavailable"));
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await createGuestOrder(input); expect(result).toMatchObject({ success: true, receiptRecoveryRequired: true });
      if (!result.success) throw new Error("Committed order was reported as failed");
      const recovered = await lookup({ checkoutToken: input.checkoutToken, ownerId: null, sourceId: cart.sourceId }); expect(recovered.status).toBe(200);
      expect((await recovered.json()).order.id).toBe(result.orderId);
      expect(await createOrder(input)).toMatchObject({ success: true, orderId: result.orderId });
      expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(99);
      expect(warning).toHaveBeenCalledTimes(2);
    } finally { warning.mockRestore(); }
  });
  it("enforces old/new receipt JSON shape and account acknowledgement constraints at the database boundary", async () => {
    const snapshot = await setLine(), result = await createOrder(checkout(context(snapshot, 1))); expect(result.success).toBe(true);
    if (!result.success) throw new Error("Account order missing");
    await expect(db.order.update({ where: { id: result.orderId }, data: { cartAcknowledgedAt: new Date() } })).rejects.toThrow();
    const value = context(snapshot, 1), oldShape = JSON.stringify(value), newShape = JSON.stringify({ ...value, previousReceiptId: null });
    const [valid] = await db.$queryRaw<{ old: boolean; modern: boolean }[]>`SELECT cart_snapshot_valid(${oldShape}::jsonb) AS old,cart_snapshot_valid(${newShape}::jsonb) AS modern`; expect(valid).toEqual({ old: true, modern: true });
    for (const changed of [{ ...value, previousReceiptId: randomUUID() }, { ...value, extra: "not-permitted" }, { ...value, version: null }, { ...value, lines: [{ ...value.lines[0], quantity: null }] }]) {
      const encoded = JSON.stringify(changed); const [row] = await db.$queryRaw<{ valid: boolean }[]>`SELECT cart_snapshot_valid(${encoded}::jsonb) AS valid`; expect(row.valid).toBe(false);
    }
  });
});
