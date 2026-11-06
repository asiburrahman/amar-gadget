import type { PrismaClient, User, Product } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn().mockResolvedValue(null), getCurrentUserWithRole: jest.fn().mockResolvedValue(null) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ set: jest.fn(), get: jest.fn() }), headers: jest.fn().mockResolvedValue(new Headers()) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import crypto, { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { createOrder } from "@/server/actions/order/order-actions";
import { cookies } from "next/headers";
import { databaseInvariantGuard } from "@/lib/database-invariant-guard";

const checkout = (productId: string) => ({ checkoutToken: "ab".repeat(32), items: [{ productId, quantity: 2 }], fullName: "Actual isolated buyer", phone: "01700000000", street: "Local test building", city: "Dhaka", district: "Dhaka", paymentMethod: "COD" as const });

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("database domains and collision-safe checkout on actual PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, seller: User, buyer: User, product: Product, sql: Client;
  beforeEach(async () => {
    jest.clearAllMocks();
    fixture = await createFinanceDatabase(); mockDatabase = fixture.db;
    [seller, buyer] = await Promise.all(["MEMBER", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@invariants.example.invalid`, role, isVerified: true } })));
    const category = await mockDatabase.category.create({ data: { name: "Isolated invariant catalog", slug: randomUUID() } });
    product = await mockDatabase.product.create({ data: { name: "Isolated purchasable item", slug: randomUUID(), price: 100, discountPrice: 90, stock: 10, status: "APPROVED", sellerId: seller.id, categoryId: category.id } });
    sql = new Client({ connectionString: fixture.url }); await sql.connect();
  }, 30_000);
  afterEach(async () => { jest.restoreAllMocks(); await sql?.end(); await fixture?.close(); });

  const protections = async () => (await mockDatabase.$queryRaw<{ valid: boolean }[]>`SELECT ${databaseInvariantGuard} AS valid`)[0].valid;
  it("requires validated checks and exact unique-index scopes without reading user data", async () => {
    expect(await protections()).toBe(true);
    await sql.query('ALTER TABLE "User" DROP CONSTRAINT "User_role_domain"'); expect(await protections()).toBe(false);
    await sql.query('ALTER TABLE "User" ADD CONSTRAINT "User_role_domain" CHECK(role IN (\'USER\',\'MEMBER\',\'ADMIN\')) NOT VALID');
    expect(await protections()).toBe(false);
    await sql.query('ALTER TABLE "User" VALIDATE CONSTRAINT "User_role_domain"'); expect(await protections()).toBe(true);
    await sql.query('DROP INDEX "Order_trackingNumber_key"'); expect(await protections()).toBe(false);
    await sql.query('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"(id)'); expect(await protections()).toBe(false);
    await sql.query('DROP INDEX "Order_trackingNumber_key"');
    await sql.query('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"("trackingNumber",(lower(id)))');
    expect(await protections()).toBe(false);
    await sql.query('DROP INDEX "Order_trackingNumber_key"');
    await sql.query('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"("trackingNumber") NULLS NOT DISTINCT');
    expect(await protections()).toBe(false);
    await sql.query('DROP INDEX "Order_trackingNumber_key"');
    await sql.query('CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"("trackingNumber")'); expect(await protections()).toBe(true);
  });

  it.each(["Address_one_default_per_user", "Review_one_canonical_user_product"])("does not accept a missing retained partial unique protection %s", async (index) => {
    expect(await protections()).toBe(true); await sql.query(`DROP INDEX "${index}"`); expect(await protections()).toBe(false);
  });

  it.each([
    ["role", "UNKNOWN", "User_role_domain"], ["sellerStatus", "UNKNOWN", "User_seller_status_domain"],
  ])("rejects an unknown account %s without changing identity or revision history", async (field, value, constraint) => {
    const before = await mockDatabase.user.findUniqueOrThrow({ where: { id: buyer.id } });
    const events = await mockDatabase.accountAdminEvent.findMany();
    await expect(sql.query(`UPDATE "User" SET "${field}"=$1 WHERE id=$2`, [value, buyer.id])).rejects.toMatchObject({ code: "23514", constraint });
    expect(await mockDatabase.user.findUniqueOrThrow({ where: { id: buyer.id } })).toEqual(before);
    expect(await mockDatabase.accountAdminEvent.findMany()).toEqual(events);
  });

  it.each([
    ["status", "UNKNOWN", "Product_status_domain"], ["price", "0", "Product_price_positive"],
    ["price", "NaN", "Product_price_positive"], ["discountPrice", "100", "Product_discount_price_valid"],
    ["discountPrice", "0", "Product_discount_price_valid"], ["discountPrice", "NaN", "Product_discount_price_valid"],
    ["stock", "-1", "Product_stock_nonnegative"],
  ])("rejects invalid product %s=%s and rolls back maintenance changes", async (field, value, constraint) => {
    // Isolate the price bound: an existing positive discount would also become
    // invalid when the regular price is changed to zero.
    if (field === "price") await mockDatabase.product.update({ where: { id: product.id }, data: { discountPrice: null } });
    const before = await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } });
    await expect(sql.query(`UPDATE "Product" SET "${field}"=$1 WHERE id=$2`, [value, product.id])).rejects.toMatchObject({ code: "23514", constraint });
    expect(await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(before);
  });

  it.each([
    ["status", "UNKNOWN", "Order_status_domain"], ["paymentMethod", "PAYPAL", "Order_payment_method_domain"],
    ["paymentStatus", "REFUNDED", "Order_payment_status_domain"], ["trackingNumber", " ", "Order_tracking_code_valid"],
    ["trackingNumber", "padded ", "Order_tracking_code_valid"], ["trackingNumber", "x".repeat(121), "Order_tracking_code_valid"],
  ])("rejects unsupported order %s before producing persistent events", async (field, value, constraint) => {
    await expect(sql.query(`INSERT INTO "Order"(id,"userId",total,"updatedAt","${field}") VALUES($1,$2,0,CURRENT_TIMESTAMP,$3)`, [randomUUID(), buyer.id, value])).rejects.toMatchObject({ code: "23514", constraint });
    expect(await mockDatabase.order.count()).toBe(0); expect(await mockDatabase.orderEvent.count()).toBe(0);
  });

  it("keeps nullable legacy tracking and enforces exact non-null uniqueness", async () => {
    await mockDatabase.order.createMany({ data: [{ userId: buyer.id, total: 0 }, { userId: buyer.id, total: 0 }] });
    await mockDatabase.order.create({ data: { userId: buyer.id, total: 0, trackingNumber: "LEGACY-KEPT" } });
    await expect(mockDatabase.order.create({ data: { userId: buyer.id, total: 0, trackingNumber: "LEGACY-KEPT" } })).rejects.toMatchObject({ code: "P2002" });
    expect(await mockDatabase.order.count()).toBe(3);
  });

  it.each([["-1", "23514"], ["NaN", "0A000"]])("rejects an invalid aggregate order amount %s without leaving an order", async (amount, code) => {
    // The existing refund-money CHECK casts total to bigint cents and rejects
    // numeric NaN before the later total bound; both paths must fully roll back.
    await expect(sql.query('INSERT INTO "Order"(id,"userId",total,"updatedAt") VALUES($1,$2,$3,CURRENT_TIMESTAMP)', [randomUUID(), buyer.id, amount])).rejects.toMatchObject({ code });
    expect(await mockDatabase.order.count()).toBe(0); expect(await mockDatabase.orderEvent.count()).toBe(0);
  });

  it.each([[0, "0"], [-1, "0"], [1, "-1"], [1, "NaN"]])("rejects invalid item quantity/price %s/%s without producing shipment evidence", async (quantity, price) => {
    const order = await mockDatabase.order.create({ data: { userId: buyer.id, total: 0 } });
    const before = await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } });
    const events = await mockDatabase.orderEvent.findMany();
    await expect(sql.query('INSERT INTO "OrderItem"(id,"orderId","productId",quantity,price,"updatedAt") VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)', [randomUUID(), order.id, product.id, quantity, price])).rejects.toMatchObject({ code: "23514" });
    expect(await mockDatabase.orderItem.count()).toBe(0); expect(await mockDatabase.orderFulfillment.count()).toBe(0);
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(before);
    expect(await mockDatabase.orderEvent.findMany()).toEqual(events);
  });

  it("retains legacy zero-priced items and quantities above the current checkout form cap", async () => {
    const order = await mockDatabase.order.create({ data: { userId: buyer.id, total: 0, items: { create: { productId: product.id, quantity: 101, price: 0 } } }, include: { items: true } });
    expect(order.items[0]).toMatchObject({ quantity: 101, netCents: null }); expect(order.items[0].price.toString()).toBe("0");
  });

  it("rolls back the colliding checkout completely, then saves one order with one stock decrement", async () => {
    const collision = `AG-${"41".repeat(16)}`;
    await mockDatabase.order.create({ data: { userId: buyer.id, total: 0, trackingNumber: collision } });
    const beforeUsers = await mockDatabase.user.count(), input = checkout(product.id), log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const entropy = jest.spyOn(crypto, "randomBytes").mockImplementationOnce((size) => Buffer.alloc(size, 0x41));
    const result = await createOrder(input);
    expect(result.success).toBe(true); if (!result.success) throw Error("Real checkout was not saved");
    expect(result.trackingNumber).toMatch(/^AG-[A-F0-9]{32}$/); expect(result.trackingNumber).not.toBe(collision);
    expect(entropy.mock.calls.filter(([size]) => size === 16)).toHaveLength(2);
    expect(await mockDatabase.order.count()).toBe(2); expect(await mockDatabase.user.count()).toBe(beforeUsers + 1);
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(8);
    expect(await mockDatabase.orderItem.count()).toBe(1); expect(log).not.toHaveBeenCalled();
    const replay = await createOrder(input); expect(replay).toMatchObject({ success: true, orderId: result.orderId, trackingNumber: result.trackingNumber });
    expect(await mockDatabase.order.count()).toBe(2); expect(await mockDatabase.user.count()).toBe(beforeUsers + 1);
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(8);
  });

  it("bounds actual repeated conflicts, leaves no guest/stock/order writes and emits only a safe incident", async () => {
    const collision = `AG-${"42".repeat(16)}`;
    await mockDatabase.order.create({ data: { userId: buyer.id, total: 0, trackingNumber: collision } });
    const beforeUsers = await mockDatabase.user.count(), log = jest.spyOn(console, "error").mockImplementation(() => undefined), input = checkout(product.id);
    const entropy = jest.spyOn(crypto, "randomBytes").mockImplementation((size) => Buffer.alloc(size, 0x42));
    const result = await createOrder(input);
    expect(result).toMatchObject({ success: false, code: "INTERNAL_ERROR", reference: expect.any(String) });
    expect(entropy.mock.calls.filter(([size]) => size === 16)).toHaveLength(3);
    expect(await mockDatabase.order.count()).toBe(1); expect(await mockDatabase.user.count()).toBe(beforeUsers);
    expect(await mockDatabase.orderItem.count()).toBe(0); expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(10);
    expect(log).toHaveBeenCalledTimes(1); const incident = JSON.parse(log.mock.calls[0][0]);
    expect(incident).toMatchObject({ operation: "checkout.create", category: "DATABASE_CONFLICT" });
    for (const value of [input.phone, input.checkoutToken, "Order_trackingNumber_key", "Private"]) expect(JSON.stringify(log.mock.calls)).not.toContain(value);
    expect((await cookies()).set).not.toHaveBeenCalled();
  });
});
