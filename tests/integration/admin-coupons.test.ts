import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { mutateCoupon, readCoupons } from "@/lib/admin-coupons";
import { calculateCheckoutQuote } from "@/lib/checkout-quote";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { CouponFields } from "@/lib/validations/coupon";
const fields = (data: Partial<CouponFields> = {}): CouponFields => ({ code: randomUUID().toUpperCase(), discount: 12.5, isPercentage: true, minSpend: null, expiresAt: null, isActive: true, ...data });
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("coupon administration with actual PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createFinanceDatabase>>, admin: User, second: User, seller: User;
  beforeAll(async () => {
    database = await createFinanceDatabase(); mockDatabase = database.db;
    [admin, second, seller] = await Promise.all(["ADMIN", "ADMIN", "MEMBER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@coupon.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
  }, 30_000);
  beforeEach(() => { jest.clearAllMocks(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); });
  afterAll(async () => { await database?.close(); });
  const create = (data: Partial<CouponFields> = {}) => mutateCoupon(admin, { action: "create", requestId: randomUUID(), fields: fields(data) });
  it("deduplicates concurrent requests, rejects changed identity and replays original receipt with current state", async () => {
    const input = { action: "create", requestId: randomUUID(), fields: fields() };
    const [a, b] = await Promise.all([mutateCoupon(admin, input), mutateCoupon(admin, input)]);
    expect(a).toEqual(b); if (a.kind !== "saved") throw new Error("Expected saved result");
    await expect(mutateCoupon(second, input)).rejects.toMatchObject({ code: "COUPON_REQUEST_CONFLICT" });
    await expect(mutateCoupon(admin, { ...input, fields: { ...input.fields, discount: 5 } })).rejects.toMatchObject({ code: "COUPON_REQUEST_CONFLICT" });
    await mutateCoupon(admin, { action: "activation", requestId: randomUUID(), id: a.row.id, version: 1, isActive: false });
    expect(await mutateCoupon(admin, input)).toMatchObject({ result: { version: 1 }, row: { version: 2, isActive: false } });
    const history = await readCoupons(admin, { mode: "history", id: a.row.id }); expect(history.events).toHaveLength(2); expect(history.events.every((event) => event.actorId === admin.id)).toBe(true);
    expect(Number(history.events[0].sequence)).toBeGreaterThan(Number(history.events[1].sequence));
    await expect(mockDatabase.couponRequest.delete({ where: { id: input.requestId } })).rejects.toThrow();
  });
  it("allows exactly one competing revision and rejects stale preview without writing", async () => {
    const a = await create(); if (a.kind !== "saved") throw new Error("Expected save");
    const update = { action: "update", id: a.row.id, version: 1, fields: fields({ code: a.row.code, discount: 25 }) };
    const outcomes = await Promise.allSettled([mutateCoupon(admin, { ...update, requestId: randomUUID() }), mutateCoupon(second, { ...update, requestId: randomUUID() })]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "COUPON_CHANGED" } });
    const count = await mockDatabase.couponEvent.count();
    await expect(mutateCoupon(admin, { action: "preview", target: { id: a.row.id, version: 1 }, fields: update.fields, subtotal: 100, paymentMethod: "COD" })).rejects.toMatchObject({ code: "COUPON_CHANGED" });
    expect(await mockDatabase.couponEvent.count()).toBe(count);
  });
  it("matches preview with checkout on actual discounted products and qualification boundaries", async () => {
    const coupon = fields({ discount: 7.35, minSpend: 900.01 }), saved = await mutateCoupon(admin, { action: "create", requestId: randomUUID(), fields: coupon });
    if (saved.kind !== "saved") throw new Error("Expected save");
    const category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } });
    const product = await mockDatabase.product.create({ data: { name: "Actual discounted product", slug: randomUUID(), price: 1000, discountPrice: 900.01, stock: 5, status: "APPROVED", sellerId: seller.id, categoryId: category.id } });
    const quote = await calculateCheckoutQuote(mockDatabase, { items: [{ productId: product.id, quantity: 1 }], couponCode: coupon.code, paymentMethod: "COD" });
    const preview = await mutateCoupon(admin, { action: "preview", target: { id: saved.row.id, version: 1 }, fields: coupon, subtotal: 900.01, paymentMethod: "COD" });
    if (preview.kind !== "preview") throw new Error("Expected preview");
    const { items, fingerprint, ...totals } = quote; expect(items).toHaveLength(1); expect(fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(preview.totals).toEqual(totals);
    expect(preview.totals).toMatchObject({ subtotal: 900.01, discountAmount: 66.15, shippingFee: 150, total: 983.86 });
    await expect(mutateCoupon(admin, { action: "preview", target: null, fields: coupon, subtotal: 900, paymentMethod: "COD" })).rejects.toMatchObject({ code: "COUPON_MIN_SPEND" });
    await mutateCoupon(admin, { action: "activation", id: saved.row.id, version: 1, isActive: false, requestId: randomUUID() });
    await expect(calculateCheckoutQuote(mockDatabase, { items: [{ productId: product.id, quantity: 1 }], couponCode: coupon.code, paymentMethod: "COD" })).rejects.toMatchObject({ code: "INVALID_COUPON" });
  });
  it("paginates literal searches, separates expired/inactive states and finds receipts outside the visible filter", async () => {
    const prefix = `PAGE_${randomUUID().slice(0, 8)}`;
    for (let n = 0; n < 22; n++) await create({ code: `${prefix}_${n}` });
    await create({ code: prefix.replace("_", "X") });
    const first = await readCoupons(admin, { q: `${prefix}_`, page: 1 }), secondPage = await readCoupons(admin, { q: `${prefix}_`, page: 2 });
    expect(first.total).toBe(22); expect(first.rows).toHaveLength(20); expect(secondPage.rows).toHaveLength(2);
    const expiry = await create({ expiresAt: new Date(0).toISOString() }); if (expiry.kind !== "saved") throw new Error("Expected save");
    expect((await readCoupons(admin, { status: "EXPIRED", q: expiry.row.code })).rows[0].status).toBe("EXPIRED");
    expect((await readCoupons(admin, { status: "ACTIVE", q: expiry.row.code })).rows).toHaveLength(0);
    const input = { action: "create", requestId: randomUUID(), fields: fields() }; const saved = await mutateCoupon(admin, input);
    const lookup = await readCoupons(admin, { q: "no-such-coupon", requestId: input.requestId }); expect(lookup.rows).toHaveLength(0); expect(lookup.attemptedRow).toEqual(saved.kind === "saved" ? saved.row : null);
  });
  it("retains purchased coupon identity and amounts while permitting future discount and availability changes", async () => {
    const coupon = fields(), saved = await mutateCoupon(admin, { action: "create", requestId: randomUUID(), fields: coupon });
    if (saved.kind !== "saved") throw new Error("Expected save");
    const order = await mockDatabase.order.create({ data: { userId: seller.id, total: 1025, couponCode: coupon.code, subtotalCents: BigInt(100000), discountCents: BigInt(12500), shippingCents: BigInt(15000), pricingReconciledAt: new Date() } });
    await expect(mutateCoupon(admin, { action: "update", requestId: randomUUID(), id: saved.row.id, version: 1, fields: { ...coupon, code: randomUUID().toUpperCase() } })).rejects.toMatchObject({ code: "COUPON_CODE_IN_USE" });
    await mutateCoupon(admin, { action: "update", requestId: randomUUID(), id: saved.row.id, version: 1, fields: { ...coupon, discount: 20, isActive: false } });
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(order);
    await expect(mockDatabase.order.update({ where: { id: order.id }, data: { couponCode: "OTHER" } })).rejects.toThrow();
    await expect(mockDatabase.coupon.delete({ where: { id: saved.row.id } })).rejects.toThrow();
  });
  it("serializes an administrator edit behind a checkout share lock and then observes the purchased code", async () => {
    const coupon = fields(), saved = await mutateCoupon(admin, { action: "create", requestId: randomUUID(), fields: coupon });
    if (saved.kind !== "saved") throw new Error("Expected save");
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { acquired = resolve; });
    const checkout = mockDatabase.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Coupon" WHERE code=${coupon.code} FOR SHARE`;
      acquired(); await gate;
      return tx.order.create({ data: { userId: seller.id, total: 1025, couponCode: coupon.code } });
    }, { timeout: 10_000 });
    await ready;
    const editing = mutateCoupon(admin, { action: "update", id: saved.row.id, version: 1, requestId: randomUUID(), fields: { ...coupon, code: randomUUID().toUpperCase() } });
    // Observe the actual blocked row-lock statement before releasing checkout.
    let blocked = false;
    try {
      for (let n = 0; n < 100; n++) {
        const rows = await mockDatabase.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Coupon%FOR UPDATE%') AS blocked`;
        if (rows[0].blocked) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally { release(); }
    await checkout;
    await expect(editing).rejects.toMatchObject({ code: "COUPON_CODE_IN_USE" });
    expect(blocked).toBe(true);
    expect((await mockDatabase.coupon.findUniqueOrThrow({ where: { id: saved.row.id } })).version).toBe(1);
  });
  it("enforces private handlers, current authority, owner, strict bounds and rate limits", async () => {
    const api = await import("@/app/api/admin/coupons/route");
    const request = (query = "", body?: unknown, owner = admin.id) => new Request(`http://localhost/api/admin/coupons${query}`, { method: body ? "POST" : "GET", headers: { "X-Coupon-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(403);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); expect((await api.GET(request("", undefined, second.id))).status).toBe(409);
    expect((await api.GET(request("?page=1&page=2"))).status).toBe(400); expect((await api.GET(request("?unexpected=1"))).status).toBe(400);
    expect((await api.POST(request("", { action: "create", requestId: randomUUID(), fields: fields({ discount: 101 }) }))).status).toBe(400);
    expect((await api.POST(request("", { padding: "a".repeat(17000) }))).status).toBe(413);
    const preview = await api.POST(request("", { action: "preview", target: null, fields: fields({ isActive: false }), subtotal: 100, paymentMethod: "COD" })); expect(preview.status).toBe(422); expect(preview.headers.get("cache-control")).toBe("private, no-store");
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); expect((await api.GET(request())).status).toBe(429);
    await expect(mutateCoupon(seller, { action: "create", requestId: randomUUID(), fields: fields() })).rejects.toMatchObject({ status: 403 });
    await mockDatabase.user.update({ where: { id: second.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(readCoupons(second, {})).rejects.toMatchObject({ code: "COUPON_ACCOUNT_CHANGED" });
  });
});
