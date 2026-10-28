/** Real PostgreSQL integration tests. No configured application DB is used. */
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn().mockResolvedValue(null),
  getCurrentUserWithRole: jest.fn().mockResolvedValue(null),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  cookies: jest.fn().mockResolvedValue({ set: jest.fn(), get: jest.fn() }),
  headers: jest.fn().mockResolvedValue(new Headers()),
}));
jest.mock("@/lib/auth", () => ({ signJwtToken: jest.fn().mockResolvedValue("integration-token") }));
jest.mock("@/lib/rate-limit", () => ({
  getClientIp: jest.fn().mockReturnValue("127.0.0.1"),
  rateLimit: jest.fn().mockResolvedValue({ success: true }),
}));

import type { PrismaClient } from "@prisma/client";
import type { CheckoutInput } from "@/lib/validations/order";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { randomBytes, randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("PostgreSQL marketplace transactions", () => {
  let db: PrismaClient;
  let createOrder: typeof import("@/server/actions/order/order-actions").createOrder;
  let verifyOtp: typeof import("@/app/api/auth/verify-otp/route").POST;
  let webhook: typeof import("@/app/api/stripe/webhook/route").POST;
  let stripe: import("stripe").default;
  let reservations: typeof import("@/lib/checkout-reservations");
  let startStripeCheckout: typeof import("@/lib/stripe/order-checkout").startStripeCheckout;
  const prefix = `audit-${randomUUID()}`;
  let sellerId: string;
  let categoryId: string;
  let productId: string;
  const guestUserIds: string[] = [];

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) {
      throw new Error("Integration tests require a localhost database named audit_*.");
    }
    process.env.DATABASE_URL = url.toString();
    process.env.STRIPE_SECRET_KEY = "sk_test_codex_integration_only";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_codex_integration_only";
    db = (await import("@/lib/prisma")).prisma;
    ({ createOrder } = await import("@/server/actions/order/order-actions"));
    ({ POST: verifyOtp } = await import("@/app/api/auth/verify-otp/route"));
    ({ POST: webhook } = await import("@/app/api/stripe/webhook/route"));
    const stripeModule = await import("@/lib/stripe/stripe");
    stripe = stripeModule.getStripe();
    jest.spyOn(stripeModule, "getStripe").mockReturnValue(stripe);
    reservations = await import("@/lib/checkout-reservations");
    ({ startStripeCheckout } = await import("@/lib/stripe/order-checkout"));
    const seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED" } });
    sellerId = seller.id;
    const category = await db.category.create({ data: { name: prefix, slug: prefix } });
    categoryId = category.id;
    const product = await db.product.create({ data: {
      name: prefix, slug: prefix, price: 1000, discountPrice: 900, stock: 10,
      status: "APPROVED", sellerId, categoryId,
    } });
    productId = product.id;
  }, 30_000); // Cold module compilation/adapter startup is separate from query timing.

  afterAll(async () => {
    if (!db) return;
    try {
      // Setup may have failed midway: never pass an undefined fixture ID to a
      // delete filter, because Prisma can omit it and broaden the operation.
      if (productId) {
        const orders = await db.order.findMany({ where: { items: { some: { productId } } }, select: { id: true, userId: true } });
        guestUserIds.push(...orders.map((order) => order.userId));
        await db.orderItem.deleteMany({ where: { productId } });
        await db.order.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
        await db.product.delete({ where: { id: productId } });
      }
      if (categoryId) await db.category.delete({ where: { id: categoryId } });
      await db.otpToken.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.user.deleteMany({ where: { OR: [{ id: { in: guestUserIds } }, { email: { startsWith: prefix } }] } });
    } finally { await db.$disconnect(); }
  }, 30_000);

  const checkout = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
    checkoutToken: randomBytes(32).toString("hex"),
    items: [{ productId, quantity: 1 }], fullName: "Codex test buyer", phone: "01700000000",
    street: "Test street", city: "Dhaka", district: "Dhaka", paymentMethod: "COD", ...overrides,
  });

  async function dispatch(event: Record<string, unknown>) {
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", ...event });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    return webhook(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature } }));
  }

  async function stripeOrder() {
    await db.product.update({ where: { id: productId }, data: { stock: 100 } });
    const result = await createOrder(checkout({ paymentMethod: "STRIPE" }));
    if (!result.success) throw new Error(result.error);
    return result.orderId;
  }

  function sessionFor(orderId: string, changes: Partial<import("stripe").default.Checkout.Session> = {}) {
    return { id: `cs_${orderId}`, metadata: { orderId }, status: "open", payment_status: "unpaid", amount_total: 105000, currency: "bdt", payment_intent: null,
      expires_at: Math.floor(Date.now() / 1000) + 1860, url: "https://checkout.stripe.com/test-only-fixture", ...changes } as import("stripe").default.Checkout.Session;
  }

  async function makeDue(orderId: string, data = {}) {
    const past = new Date(Date.now() - 60_000);
    await db.order.update({ where: { id: orderId }, data: { reservationExpiresAt: past, reservationNextCheckAt: past, ...data } });
  }

  it("commits COD checkout using current server price and stock", async () => {
    const result = await createOrder(checkout());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(Number(order.total)).toBe(1050); // 900 discounted price + 150 shipping
    expect(order.status).toBe("PROCESSING");
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(9);
  });

  it("rolls back stock, guest user and order when a later item is invalid", async () => {
    const before = await db.user.count();
    const stock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
    const result = await createOrder(checkout({ items: [{ productId, quantity: 1 }, { productId: randomUUID(), quantity: 1 }] }));
    expect(result.success).toBe(false);
    expect(await db.user.count()).toBe(before);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock);
  });

  it("does not oversell the final unit under concurrent checkouts", async () => {
    await db.product.update({ where: { id: productId }, data: { stock: 1 } });
    const results = await Promise.all([createOrder(checkout()), createOrder(checkout())]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(0);
    await db.product.update({ where: { id: productId }, data: { stock: 10 } });
  });

  it("returns one order and one guest for concurrent retries of the same final-unit checkout", async () => {
    await db.product.update({ where: { id: productId }, data: { stock: 1 } });
    const input = checkout();
    const usersBefore = await db.user.count();
    const ordersBefore = await db.order.count({ where: { items: { some: { productId } } } });
    const results = await Promise.all(Array.from({ length: 4 }, () => createOrder(input)));
    expect(results.every((result) => result.success)).toBe(true);
    expect(new Set(results.filter((result) => result.success).map((result) => result.orderId)).size).toBe(1);
    expect(await db.user.count()).toBe(usersBefore + 1);
    expect(await db.order.count({ where: { items: { some: { productId } } } })).toBe(ordersBefore + 1);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(0);
    await db.product.update({ where: { id: productId }, data: { stock: 10 } });
  });

  it("replays the committed order without repricing or reserving stock again", async () => {
    const input = checkout();
    const first = await createOrder(input);
    if (!first.success) throw new Error(first.error);
    await db.product.update({ where: { id: productId }, data: { price: 2000, discountPrice: null, stock: 0 } });
    try {
      const retry = await createOrder(input);
      expect(retry.success && retry.orderId).toBe(first.orderId);
      const order = await db.order.findUniqueOrThrow({ where: { id: first.orderId } });
      expect(Number(order.total)).toBe(1050);
      expect(order.checkoutTokenHash).not.toBe(input.checkoutToken);
      expect(order.checkoutRequestHash).toMatch(/^[a-f0-9]{64}$/);
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(0);
    } finally {
      await db.product.update({ where: { id: productId }, data: { price: 1000, discountPrice: 900, stock: 10 } });
    }
  });

  it("recovers the committed order when response-cookie writing fails after commit", async () => {
    const input = checkout();
    const usersBefore = await db.user.count();
    const ordersBefore = await db.order.count({ where: { items: { some: { productId } } } });
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (cookies as jest.Mock).mockResolvedValueOnce({ set: () => { throw new Error("Simulated lost response boundary"); } });
    try {
      expect(await createOrder(input)).toMatchObject({ success: false, code: "INTERNAL_ERROR" });
      expect((await createOrder(input)).success).toBe(true);
      expect(await db.user.count()).toBe(usersBefore + 1);
      expect(await db.order.count({ where: { items: { some: { productId } } } })).toBe(ordersBefore + 1);
    } finally { log.mockRestore(); }
  });

  it.each([
    { street: "Different shipping address" },
    { paymentMethod: "STRIPE" as const },
    { couponCode: "DIFFERENT" },
  ])("rejects changed payload reuse without modifying the original order: %j", async (change) => {
    const input = checkout();
    const first = await createOrder(input);
    if (!first.success) throw new Error(first.error);
    const stock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
    const retry = await createOrder({ ...input, ...change });
    expect(retry).toMatchObject({ success: false, code: "CHECKOUT_CONFLICT" });
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock);
    expect((await db.order.findUniqueOrThrow({ where: { id: first.orderId } })).paymentMethod).toBe("COD");
  });

  it("binds an attempt to its current account identity", async () => {
    const input = checkout();
    expect((await createOrder(input)).success).toBe(true);
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: sellerId, role: "MEMBER", sellerStatus: "APPROVED" });
    try {
      expect(await createOrder(input)).toMatchObject({ success: false, code: "CHECKOUT_CONFLICT" });
    } finally {
      (getCurrentUser as jest.Mock).mockResolvedValue(null);
    }
  });

  it("allows the same attempt after a failed transaction without retaining partial writes", async () => {
    await db.product.update({ where: { id: productId }, data: { stock: 0 } });
    const input = checkout();
    expect(await createOrder(input)).toMatchObject({ success: false, code: "OUT_OF_STOCK" });
    await db.product.update({ where: { id: productId }, data: { stock: 10 } });
    expect((await createOrder(input)).success).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(9);
  });

  it("rejects excessive/malformed input before creating any transaction", async () => {
    const transaction = jest.spyOn(db, "$transaction");
    try {
      expect(await createOrder(checkout({ checkoutToken: "invalid" }))).toMatchObject({ success: false, code: "INVALID_CHECKOUT" });
      expect(await createOrder(checkout({ items: [{ productId, quantity: 101 }] }))).toMatchObject({ success: false, code: "INVALID_CHECKOUT" });
      expect(await createOrder(checkout({ items: [{ productId, quantity: 1 }, { productId, quantity: 1 }] }))).toMatchObject({ success: false, code: "INVALID_CHECKOUT" });
      expect(transaction).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); }
  });

  it("denies rate-limited IPs and contacts before writes", async () => {
    const transaction = jest.spyOn(db, "$transaction");
    try {
      (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false });
      expect(await createOrder(checkout())).toMatchObject({ success: false, code: "RATE_LIMITED" });
      (rateLimit as jest.Mock).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
      expect(await createOrder(checkout())).toMatchObject({ success: false, code: "RATE_LIMITED" });
      expect(transaction).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); }
  });

  it("consumes an OTP once and commits account verification", async () => {
    const email = `${prefix}-otp@example.invalid`;
    const user = await db.user.create({ data: { email, isVerified: false } });
    await db.otpToken.create({ data: { email, code: "123456", expiresAt: new Date(Date.now() + 60_000) } });
    const request = () => new Request("http://localhost/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ email, otp: "123456" }) });
    const responses = await Promise.all([verifyOtp(request()), verifyOtp(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isVerified).toBe(true);
    expect(await db.otpToken.count({ where: { email } })).toBe(0);
  });

  it("verifies a signed payment event and tolerates duplicate delivery", async () => {
    const input = checkout({ paymentMethod: "STRIPE" });
    const result = await createOrder(input);
    if (!result.success) throw new Error(result.error);
    const event = { type: "payment_intent.succeeded", data: { object: { id: "pi_codex_test", metadata: { orderId: result.orderId }, amount_received: 105000, currency: "bdt" } } };
    expect((await dispatch(event)).status).toBe(200);
    expect((await dispatch(event)).status).toBe(200);
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.paymentStatus).toBe("PAID");
    expect(order.status).toBe("PROCESSING");
    expect(order.paymentIntentId).toBe("pi_codex_test");
    expect(await createOrder(input)).toMatchObject({ success: true, orderId: result.orderId, paymentStatus: "PAID" });
  });

  it("restocks an expired unpaid Stripe order exactly once", async () => {
    const stock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
    const input = checkout({ paymentMethod: "STRIPE" });
    const result = await createOrder(input);
    if (!result.success) throw new Error(result.error);
    const event = { type: "checkout.session.expired", data: { object: { id: `cs_${randomUUID()}`, status: "expired", payment_status: "unpaid", metadata: { orderId: result.orderId } } } };
    expect((await dispatch(event)).status).toBe(200);
    expect((await dispatch(event)).status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock);
    expect((await db.order.findUniqueOrThrow({ where: { id: result.orderId } })).status).toBe("CANCELLED");
    expect(await createOrder(input)).toMatchObject({ success: false, code: "CHECKOUT_CLOSED" });
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock);
  });

  it("excludes approved products from unapproved sellers across catalog queries and counts", async () => {
    for (const sellerStatus of ["BLOCKED", "PENDING", "REJECTED"]) {
      await db.user.update({ where: { id: sellerId }, data: { sellerStatus } });
      expect(await db.product.findMany({ where: { ...publicProductWhere, id: productId } })).toEqual([]);
      const category = await db.category.findUniqueOrThrow({ where: { id: categoryId }, include: { products: { where: publicProductWhere }, _count: { select: { products: { where: publicProductWhere } } } } });
      expect(category.products).toEqual([]);
      expect(category._count.products).toBe(0);
      expect((await createOrder(checkout())).success).toBe(false);
    }
    await db.user.update({ where: { id: sellerId }, data: { sellerStatus: "APPROVED" } });
    expect(await db.product.count({ where: { ...publicProductWhere, id: productId } })).toBe(1);
  });

  it("expires abandoned pre-session reservations exactly once with overlapping cleaners", async () => {
    const orderId = await stripeOrder();
    const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
    await makeDue(orderId);
    const results = await Promise.all([reservations.reconcileReservation(orderId), reservations.reconcileReservation(orderId)]);
    expect(results.filter((result) => result === "released")).toHaveLength(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before + 1);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
  });

  it("does not expire live pre-session reservations or COD orders", async () => {
    const orderId = await stripeOrder();
    expect(await reservations.reconcileReservation(orderId)).toBe("unchanged");
    const cod = await createOrder(checkout());
    if (!cod.success) throw new Error(cod.error);
    await makeDue(cod.orderId);
    expect(await reservations.reconcileReservation(cod.orderId)).toBe("unchanged");
    expect((await db.order.findUniqueOrThrow({ where: { id: cod.orderId } })).status).toBe("PROCESSING");
  });

  it("retains uncertain provider reservations and replays immutable session parameters", async () => {
    const orderId = await stripeOrder();
    const create = jest.spyOn(stripe.checkout.sessions, "create").mockRejectedValueOnce(new Error("Response lost"));
    try {
      await expect(startStripeCheckout(orderId, "https://shop.example")).rejects.toThrow("Response lost");
      const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
      expect(await reservations.reconcileReservation(orderId, new Date(Date.now() + 3600_000))).toBe("review");
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before);
      create.mockResolvedValueOnce(sessionFor(orderId) as never);
      await startStripeCheckout(orderId, "https://different-request-origin.example");
      expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).stripeCheckoutSessionId).toBe(`cs_${orderId}`);
    } finally { create.mockRestore(); }
  });

  it("expires a known open provider session before restoring inventory", async () => {
    const orderId = await stripeOrder();
    await makeDue(orderId, { stripeSessionRequestedAt: new Date(), stripeCheckoutSessionId: `cs_${orderId}` });
    const retrieve = jest.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(sessionFor(orderId) as never);
    const expire = jest.spyOn(stripe.checkout.sessions, "expire").mockResolvedValue(sessionFor(orderId, { status: "expired" }) as never);
    try {
      const stock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
      expect(await reservations.reconcileReservation(orderId)).toBe("released");
      expect(expire).toHaveBeenCalledWith(`cs_${orderId}`);
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock + 1);
    } finally { retrieve.mockRestore(); expire.mockRestore(); }
  });

  it("records payment winning provider expiry without restocking", async () => {
    const orderId = await stripeOrder();
    await makeDue(orderId, { stripeSessionRequestedAt: new Date(), stripeCheckoutSessionId: `cs_${orderId}` });
    const retrieve = jest.spyOn(stripe.checkout.sessions, "retrieve")
      .mockResolvedValueOnce(sessionFor(orderId) as never)
      .mockResolvedValueOnce(sessionFor(orderId, { status: "complete", payment_status: "paid", payment_intent: "pi_race" }) as never);
    const expire = jest.spyOn(stripe.checkout.sessions, "expire").mockRejectedValue(new Error("Already completed"));
    try {
      const stock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
      expect(await reservations.reconcileReservation(orderId)).toBe("paid");
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock);
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe("PAID");
    } finally { retrieve.mockRestore(); expire.mockRestore(); }
  });

  it("records late payment for refund review without reviving a cancelled order", async () => {
    const orderId = await stripeOrder();
    await makeDue(orderId);
    await reservations.reconcileReservation(orderId);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await reservations.confirmStripePayment(orderId, "pi_late", 105000, "bdt");
      expect(await db.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: "CANCELLED", paymentStatus: "PAID", reservationReviewReason: "LATE_PAYMENT_REQUIRES_REFUND" });
    } finally { log.mockRestore(); }
  });

  it("requires worker authorization and enforces bounded, repeatable cleanup", async () => {
    const orderId = await stripeOrder();
    await makeDue(orderId);
    const { POST } = await import("@/app/api/internal/checkout/expire/route");
    process.env.CHECKOUT_SWEEP_SECRET = "integration-sweep-secret-32-characters-only";
    process.env.CHECKOUT_SWEEP_DATABASE = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
    expect((await POST(new Request("http://localhost/api/internal/checkout/expire", { method: "POST" }))).status).toBe(401);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
    const authorization = `Bearer ${process.env.CHECKOUT_SWEEP_SECRET}`;
    process.env.CHECKOUT_SWEEP_DATABASE = "different_database";
    expect((await POST(new Request("http://localhost/api/internal/checkout/expire", { method: "POST", headers: { authorization } }))).status).toBe(503);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
    process.env.CHECKOUT_SWEEP_DATABASE = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
    const result = await POST(new Request("http://localhost/api/internal/checkout/expire", { method: "POST", headers: { authorization: `Bearer ${process.env.CHECKOUT_SWEEP_SECRET}` } }));
    expect(result.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
    expect((await reservations.sweepReservations(1)).checked).toBeLessThanOrEqual(1);
  });

  it("retains stock and schedules review when Stripe reconciliation is unavailable", async () => {
    const orderId = await stripeOrder();
    await makeDue(orderId, { stripeSessionRequestedAt: new Date(), stripeCheckoutSessionId: `cs_${orderId}` });
    const retrieve = jest.spyOn(stripe.checkout.sessions, "retrieve").mockRejectedValue(new Error("Provider unavailable"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
      expect((await reservations.sweepReservations()).errors).toBeGreaterThanOrEqual(1);
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order).toMatchObject({ status: "PENDING", reservationReviewReason: "PROVIDER_RECONCILIATION_FAILED" });
      expect(order.reservationNextCheckAt!.getTime()).toBeGreaterThan(Date.now());
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before);
    } finally { retrieve.mockRestore(); log.mockRestore(); }
  });

  it("restocks once when a signed expiry webhook overlaps a worker", async () => {
    const orderId = await stripeOrder();
    await makeDue(orderId, { stripeSessionRequestedAt: new Date(), stripeCheckoutSessionId: `cs_${orderId}` });
    const session = sessionFor(orderId, { status: "expired" });
    const retrieve = jest.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(session as never);
    try {
      const before = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
      await Promise.all([
        reservations.reconcileReservation(orderId),
        dispatch({ type: "checkout.session.expired", data: { object: session } }),
      ]);
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(before + 1);
    } finally { retrieve.mockRestore(); }
  });
});
