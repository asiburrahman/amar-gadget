import type { PrismaClient, User, Product, Category } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(), getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: jest.fn() }) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { mutateProductMaintenance, readProductMaintenance } from "@/lib/product-maintenance";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { getCurrentUser, getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { updateProductStatus } from "@/server/actions/admin/admin-actions";
import { getOrderById } from "@/server/actions/order/order-actions";
import { readSellerFulfillments } from "@/lib/fulfillments";
import { readCustomerDashboard } from "@/lib/dashboard-metrics";
import type { MaintenanceFields } from "@/lib/validations/product-maintenance";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("seller catalog maintenance with actual PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createFinanceDatabase>>, seller: User, other: User, admin: User, buyer: User, category: Category, product: Product;
  beforeAll(async () => { fixture = await createFinanceDatabase(); mockDatabase = fixture.db; }, 30_000);
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    [seller, other, admin, buyer] = await Promise.all(["MEMBER", "MEMBER", "ADMIN", "USER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@maintenance.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
    category = await mockDatabase.category.create({ data: { name: randomUUID(), slug: randomUUID() } });
    product = await mockDatabase.product.create({ data: { name: "Original purchased gadget", slug: randomUUID(), price: 100, stock: 10, sellerId: seller.id, categoryId: category.id, imageUrl: "https://cdn.example.invalid/verified-existing.png", status: "APPROVED" } });
    jest.clearAllMocks(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (getCurrentUser as jest.Mock).mockResolvedValue(buyer); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
  });
  const fields = (changes: Partial<MaintenanceFields> = {}): MaintenanceFields => ({ name: product.name, description: null, specifications: [], price: 100, discountPrice: null, categoryId: category.id, brandId: null, ...changes });
  const identity = (row = product) => ({ id: row.id, version: row.catalogVersion, requestId: randomUUID(), reason: "Actual reviewed warehouse/catalog operation" });
  it("paginates only owned products and treats search wildcard characters literally", async () => {
    await mockDatabase.product.createMany({ data: Array.from({ length: 13 }, (_, i) => ({ name: `Literal_%_gadget_${i}`, slug: randomUUID(), price: 100, stock: 1, sellerId: seller.id, categoryId: category.id, status: "ARCHIVED" })) });
    await mockDatabase.product.create({ data: { name: "Literal_%_foreign", slug: randomUUID(), price: 100, stock: 1, sellerId: other.id, categoryId: category.id, status: "ARCHIVED" } });
    const first = await readProductMaintenance(seller, { q: "_%_", status: "ARCHIVED" }), second = await readProductMaintenance(seller, { q: "_%_", status: "ARCHIVED", page: 2 });
    expect(first).toMatchObject({ total: 13, totalPages: 2 }); expect(first.rows).toHaveLength(12); expect(second.rows).toHaveLength(1); expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(13);
    await expect(readProductMaintenance(seller, { q: "_%_", page: 3 })).rejects.toMatchObject({ code: "PRODUCT_PAGE" });
    expect((await readProductMaintenance(seller, { q: product.id })).rows.map((row) => row.id)).toEqual([product.id]);
  });
  it("rejects unchanged content, missing taxonomy and invalid archived product resubmission", async () => {
    await expect(mutateProductMaintenance(seller, { ...identity(), action: "edit", fields: fields() })).rejects.toMatchObject({ code: "PRODUCT_NO_CHANGE" });
    await expect(mutateProductMaintenance(seller, { ...identity(), action: "edit", fields: fields({ categoryId: "missing-category" }) })).rejects.toMatchObject({ code: "PRODUCT_TAXONOMY" });
    const archived = await mockDatabase.product.update({ where: { id: product.id }, data: { status: "ARCHIVED", imageUrl: null, images: [] } });
    await expect(mutateProductMaintenance(seller, { ...identity(archived), action: "resubmit", confirmed: true })).rejects.toMatchObject({ code: "PRODUCT_RESUBMIT_FIELDS" });
    expect(await mockDatabase.productMaintenanceRequest.count({ where: { ownerId: seller.id } })).toBe(0);
  });
  it("edits only owned metadata, hides it for reapproval and refuses the administrator's stale review", async () => {
    const prior = product.catalogVersion, changed = await mutateProductMaintenance(seller, { ...identity(), action: "edit", fields: fields({ name: "Updated gadget title", price: 120, discountPrice: 110 }) });
    expect(changed.row).toMatchObject({ status: "PENDING_APPROVAL", catalogVersion: 2, inventoryVersion: 1, stock: 10, slug: product.slug }); expect(await mockDatabase.product.count({ where: { ...publicProductWhere, id: product.id } })).toBe(0);
    expect(await updateProductStatus(product.id, "APPROVED", prior)).toMatchObject({ success: false, error: expect.stringContaining("changed") });
    expect((await updateProductStatus(product.id, "APPROVED", 2)).success).toBe(true); expect(await mockDatabase.product.count({ where: { ...publicProductWhere, id: product.id } })).toBe(1);
  });
  it("deduplicates concurrent inventory intents and rejects conflicting identity or stale stock without overwrites", async () => {
    const input = { ...identity(), action: "stock", inventoryVersion: 1, delta: 5, confirmed: true };
    const [a, b] = await Promise.all([mutateProductMaintenance(seller, input), mutateProductMaintenance(seller, input)]); expect(a).toEqual(b); expect(a.row).toMatchObject({ stock: 15, status: "APPROVED", catalogVersion: 1, inventoryVersion: 2 });
    await expect(mutateProductMaintenance(seller, { ...input, delta: 10 })).rejects.toMatchObject({ code: "PRODUCT_REQUEST_CONFLICT" });
    await mockDatabase.product.update({ where: { id: product.id }, data: { stock: { decrement: 1 } } });
    expect(await mutateProductMaintenance(seller, input)).toMatchObject({ result: { stock: 15, inventoryVersion: 2 }, row: { stock: 14, inventoryVersion: 3 } });
    await expect(mutateProductMaintenance(seller, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "PRODUCT_INVENTORY_CHANGED" });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(14);
  });
  it("bounds inventory adjustments and leaves catalog drafts valid across checkout-style stock changes", async () => {
    await expect(mutateProductMaintenance(seller, { ...identity(), action: "stock", inventoryVersion: 1, delta: -11, confirmed: true })).rejects.toMatchObject({ code: "PRODUCT_STOCK_RANGE" });
    await expect(mutateProductMaintenance(seller, { ...identity(), action: "stock", inventoryVersion: 1, delta: 2147483647, confirmed: true })).rejects.toMatchObject({ code: "PRODUCT_STOCK_RANGE" });
    await mockDatabase.product.update({ where: { id: product.id }, data: { stock: { decrement: 1 } } });
    const edited = await mutateProductMaintenance(seller, { ...identity(), action: "edit", fields: fields({ description: "Actual revised product description" }) }); expect(edited.row).toMatchObject({ stock: 9, inventoryVersion: 2, catalogVersion: 2 });
    await expect(mutateProductMaintenance(seller, { ...identity(), action: "archive", confirmed: true })).rejects.toMatchObject({ code: "PRODUCT_CHANGED" });
  });
  it("lets an in-flight checkout finish its real seller foreign key while a stock adjustment waits, then rejects the stale adjustment", async () => {
    let acquired!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const checkout = mockDatabase.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: 1 } } }); acquired(); await gate;
      return tx.order.create({ data: { userId: buyer.id, total: 100, paymentMethod: "COD", items: { create: [{ productId: product.id, quantity: 1, price: 100 }] } } });
    }, { timeout: 10_000 });
    await ready;
    const updating = mutateProductMaintenance(seller, { ...identity(), action: "stock", inventoryVersion: 1, delta: 5, confirmed: true });
    let blocked = false;
    try {
      for (let index = 0; index < 100; index++) {
        const [row] = await mockDatabase.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM "Product"%FOR UPDATE%') AS blocked`;
        if (row.blocked) { blocked = true; break; } await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally { release(); }
    const order = await checkout; await expect(updating).rejects.toMatchObject({ code: "PRODUCT_INVENTORY_CHANGED" }); expect(blocked).toBe(true); expect(await mockDatabase.orderFulfillment.count({ where: { orderId: order.id, sellerId: seller.id } })).toBe(1);
    const current = await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } }); expect(current.stock).toBe(9);
    expect(await mutateProductMaintenance(seller, { ...identity(current), action: "stock", inventoryVersion: current.inventoryVersion, delta: 5, confirmed: true })).toMatchObject({ row: { stock: 14, inventoryVersion: 3 } });
  });
  it("archives/restores through review while retaining original order labels, money and captured shipments", async () => {
    const order = await mockDatabase.order.create({ data: { userId: buyer.id, total: 100, paymentMethod: "STRIPE", paymentStatus: "PAID", items: { create: [{ productId: product.id, quantity: 1, price: 100 }] } }, include: { items: true, fulfillments: true } });
    const archived = await mutateProductMaintenance(seller, { ...identity(), action: "archive", confirmed: true }); expect(archived.row?.status).toBe("ARCHIVED"); expect((await updateProductStatus(product.id, "APPROVED", 2)).success).toBe(false);
    await mutateProductMaintenance(seller, { ...identity({ ...product, catalogVersion: 2 }), action: "edit", fields: fields({ name: "Completely revised catalog label", price: 200 }) });
    const latest = await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } }); expect(latest.status).toBe("ARCHIVED");
    const purchase = await getOrderById(order.id); expect(purchase.success && purchase.data?.items[0].product.name).toBe("Original purchased gadget"); expect(purchase.success && purchase.data?.items[0].price).toBe(100);
    expect((await readSellerFulfillments(seller, { orderId: order.id })).shipments[0].items[0].name).toBe("Original purchased gadget"); expect((await readCustomerDashboard(buyer)).recent[0].items[0].product.name).toBe("Original purchased gadget");
    expect(await mockDatabase.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, fulfillments: true } })).toEqual(order);
    await expect(mockDatabase.product.delete({ where: { id: product.id } })).rejects.toThrow();
    const resubmitted = await mutateProductMaintenance(seller, { ...identity(latest), action: "resubmit", confirmed: true }); expect(resubmitted.row?.status).toBe("PENDING_APPROVAL");
  });
  it("denies foreign ownership, unapproved/revoked sessions and forged content fields", async () => {
    for (const actor of [other, admin]) { await expect(readProductMaintenance(actor, { mode: "record", id: product.id })).rejects.toMatchObject({ status: 404 }); await expect(mutateProductMaintenance(actor, { ...identity(), action: "archive", confirmed: true })).rejects.toMatchObject({ status: 404 }); }
    await expect(mutateProductMaintenance(seller, { ...identity(), action: "edit", fields: { ...fields(), stock: 999, isFeatured: true, sellerId: other.id, status: "APPROVED" } })).rejects.toThrow();
    await mockDatabase.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); await expect(readProductMaintenance(seller, {})).rejects.toMatchObject({ status: 403 });
  });
  it("retains immutable reasoned events and original receipts outside filters and after an unreferenced deletion", async () => {
    const input = { ...identity(), action: "stock", inventoryVersion: 1, delta: 2, confirmed: true }; const saved = await mutateProductMaintenance(seller, input);
    const history = await readProductMaintenance(seller, { mode: "history", id: product.id }); expect(history.events).toHaveLength(1); expect(history.events[0]).toMatchObject({ actorId: seller.id, reason: input.reason, before: { stock: 10 }, after: { stock: 12 } });
    const receipt = await readProductMaintenance(seller, { q: "absent", requestId: input.requestId }); expect(receipt.rows).toHaveLength(0); expect(receipt.attemptedRow?.stock).toBe(12);
    await expect(mockDatabase.productMaintenanceRequest.delete({ where: { id: input.requestId } })).rejects.toThrow(); await mockDatabase.product.delete({ where: { id: product.id } });
    expect(await mutateProductMaintenance(seller, input)).toMatchObject({ result: saved.result, row: null, currentUnavailable: true });
  });
  it("protects strict private handlers, owner, bounded JSON, confirmations and limits", async () => {
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller); const api = await import("@/app/api/member/products/route"), request = (query = "", body?: unknown, owner = seller.id) => new Request(`http://localhost/api/member/products${query}`, { method: body ? "POST" : "GET", headers: { "X-Product-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await api.GET(request())).headers.get("cache-control")).toBe("private, no-store"); expect((await api.GET(request("", undefined, other.id))).status).toBe(409); expect((await api.GET(request("?page=1&page=2"))).status).toBe(400);
    expect((await api.POST(request("", { ...identity(), action: "archive", confirmed: false }))).status).toBe(400); expect((await api.POST(request("", { padding: "x".repeat(196609) }))).status).toBe(413);
    (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); expect((await api.GET(request())).status).toBe(429);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(403);
  });
});
