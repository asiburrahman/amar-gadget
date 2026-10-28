/** Real PostgreSQL integration tests. No configured application DB is used. */
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn().mockResolvedValue(null),
  getCurrentUserWithRole: jest.fn().mockResolvedValue(null),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  cookies: jest.fn().mockResolvedValue({ set: jest.fn(), get: jest.fn() }),
}));
jest.mock("@/lib/auth", () => ({ signJwtToken: jest.fn().mockResolvedValue("integration-token") }));
jest.mock("@/lib/rate-limit", () => ({
  getClientIp: jest.fn().mockReturnValue("127.0.0.1"),
  rateLimit: jest.fn().mockResolvedValue({ success: true }),
}));

import type { PrismaClient } from "@prisma/client";
import type { CheckoutInput } from "@/lib/validations/order";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { randomUUID } from "node:crypto";

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
  });

  afterAll(async () => {
    if (!db) return;
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
    await db.$disconnect();
  });

  const checkout = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
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
    const result = await createOrder(checkout({ paymentMethod: "STRIPE" }));
    if (!result.success) throw new Error(result.error);
    const event = { type: "payment_intent.succeeded", data: { object: { id: "pi_codex_test", metadata: { orderId: result.orderId }, amount_received: 105000, currency: "bdt" } } };
    expect((await dispatch(event)).status).toBe(200);
    expect((await dispatch(event)).status).toBe(200);
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.paymentStatus).toBe("PAID");
    expect(order.status).toBe("PROCESSING");
    expect(order.paymentIntentId).toBe("pi_codex_test");
  });

  it("restocks an expired unpaid Stripe order exactly once", async () => {
    const stock = (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
    const result = await createOrder(checkout({ paymentMethod: "STRIPE" }));
    if (!result.success) throw new Error(result.error);
    const event = { type: "checkout.session.expired", data: { object: { metadata: { orderId: result.orderId } } } };
    expect((await dispatch(event)).status).toBe(200);
    expect((await dispatch(event)).status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(stock);
    expect((await db.order.findUniqueOrThrow({ where: { id: result.orderId } })).status).toBe("CANCELLED");
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
