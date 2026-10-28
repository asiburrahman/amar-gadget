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
    stripe = (await import("@/lib/stripe/stripe")).getStripe();
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
    const event = { type: "checkout.session.expired", data: { object: { metadata: { orderId: result.orderId } } } };
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
});
