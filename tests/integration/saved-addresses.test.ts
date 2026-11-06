jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(), getCurrentUserWithRole: jest.fn() }));
jest.mock("@/lib/session-validation", () => ({ validateSessionToken: jest.fn() }));
jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: () => ({ value: "local-address-token" }), set: jest.fn() }), headers: jest.fn().mockResolvedValue(new Headers()) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { validateSessionToken } from "@/lib/session-validation";
import { rateLimit } from "@/lib/rate-limit";
import * as addresses from "@/app/api/user/addresses/route";
import { PUT as updateProfile } from "@/app/api/user/profile/route";
import { createOrder } from "@/server/actions/order/order-actions";
import { setTimeout as delay } from "node:timers/promises";
const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("saved addresses: actual guarded HTTP handlers and PostgreSQL", () => {
  let db: PrismaClient, owner: User, other: User;
  const prefix = `audit-address-${randomUUID()}`;
  const fields = (fullName = "Home recipient") => ({ fullName, phone: "01700000000", street: "House 12, Real road", city: "Dhaka", district: "Dhaka", zipCode: "1200" });
  const request = (method: string, body?: unknown, query = "") => new Request(`http://localhost/api/user/addresses${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = async (name = "Home recipient", makeDefault = false) => {
    const response = await addresses.POST(request("POST", { fields: fields(name), makeDefault })); expect(response.status).toBe(201); return (await response.json()).address;
  };
  const revision = (address: { id: string; version: number }) => ({ id: address.id, version: address.version });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, name: "Original owner", isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, isVerified: true } });
  });
  beforeEach(async () => {
    await db.address.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
    owner = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    (getCurrentUser as jest.Mock).mockResolvedValue(owner); (validateSessionToken as jest.Mock).mockResolvedValue(owner); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
  });
  afterAll(async () => { if (db) try { await db.address.deleteMany({ where: { userId: { in: [owner?.id, other?.id].filter(Boolean) } } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); } finally { await db.$disconnect(); } });
  it("creates the first default, edits normalized owned data and returns private bounded DTOs", async () => {
    const first = await create(); expect(first.isDefault).toBe(true); expect(first.version).toBe(1); expect(first.userId).toBeUndefined();
    const response = await addresses.PUT(request("PUT", { ...revision(first), fields: { ...fields(), fullName: "  Edited recipient  ", zipCode: "" } }));
    expect(response.status).toBe(200); expect((await response.json()).address).toMatchObject({ fullName: "Edited recipient", zipCode: null, version: 2, isDefault: true });
    const listed = await addresses.GET(request("GET")); expect(listed.headers.get("cache-control")).toBe("private, no-store");
    const data = await listed.json(); expect(data).toMatchObject({ total: 1, totalPages: 1, page: 1, defaultAddress: { id: first.id, version: 2 } }); expect(data.addresses).toHaveLength(1);
  });
  it("switches a single default, bumps affected revisions and deterministically promotes a remaining address on deletion", async () => {
    const first = await create("First recipient"), second = await create("Second recipient"), third = await create("Third recipient");
    const response = await addresses.PATCH(request("PATCH", revision(second))); expect(response.status).toBe(200);
    const current = (await response.json()).address; expect(current.isDefault).toBe(true); expect(current.version).toBe(2);
    expect((await db.address.findUniqueOrThrow({ where: { id: first.id } })).version).toBe(2);
    expect((await addresses.DELETE(request("DELETE", revision(current)))).status).toBe(200);
    const promoted = await db.address.findUniqueOrThrow({ where: { id: first.id } }); expect(promoted.isDefault).toBe(true); expect(promoted.version).toBe(3);
    expect((await addresses.DELETE(request("DELETE", revision(promoted)))).status).toBe(200);
    const final = await db.address.findUniqueOrThrow({ where: { id: third.id } }); expect(final.isDefault).toBe(true);
    expect((await addresses.DELETE(request("DELETE", revision(final)))).status).toBe(200);
    expect((await (await addresses.GET(request("GET"))).json()).defaultAddress).toBeNull();
  });
  it("never reads or mutates another owner's address and rejects caller-selected owner/status/version fields", async () => {
    const foreign = await db.address.create({ data: { ...fields("Foreign recipient"), userId: other.id, isDefault: true } });
    for (const method of ["PUT", "PATCH", "DELETE"] as const) expect((await addresses[method](request(method, { ...revision(foreign), ...(method === "PUT" ? { fields: fields() } : {}) }))).status).toBe(404);
    expect((await addresses.GET(request("GET", undefined, `?userId=${other.id}`))).status).toBe(400);
    expect((await (await addresses.GET(request("GET"))).json()).total).toBe(0);
    for (const extra of [{ userId: other.id }, { id: foreign.id }, { isDefault: true }, { version: 1 }]) expect((await addresses.POST(request("POST", { fields: fields(), ...extra }))).status).toBe(400);
    expect(await db.address.findUnique({ where: { id: foreign.id } })).toEqual(foreign);
  });
  it("rejects invalid fields, malformed/oversized JSON, duplicate pagination and stale versions before mutation", async () => {
    for (const changes of [{ phone: "123" }, { fullName: "\0bad" }, { street: "x".repeat(501) }, { city: "" }, { district: "x\nBad" }, { zipCode: "x".repeat(21) }]) expect((await addresses.POST(request("POST", { fields: { ...fields(), ...changes } }))).status).toBe(400);
    expect((await addresses.POST(new Request("http://localhost/api/user/addresses", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await addresses.POST(new Request("http://localhost/api/user/addresses", { method: "POST", body: "x".repeat(4097) }))).status).toBe(413);
    for (const query of ["?page=0", "?page=1&page=2", "?page=-1", "?page=1000001", "?page=x"]) expect((await addresses.GET(request("GET", undefined, query))).status).toBe(400);
    const saved = await create();
    expect((await addresses.PUT(request("PUT", { ...revision(saved), version: 2, fields: fields("Stale recipient") }))).status).toBe(409);
    expect((await db.address.findUniqueOrThrow({ where: { id: saved.id } })).version).toBe(1);
  });
  it("serializes concurrent edits and competing default writes with one current revision and one default", async () => {
    const first = await create(), second = await create("Office recipient"), third = await create("Another recipient");
    const edits = await Promise.all(["Alpha recipient", "Bravo recipient"].map((name) => addresses.PUT(request("PUT", { ...revision(second), fields: fields(name) }))));
    expect(edits.map((response) => response.status).sort()).toEqual([200, 409]);
    const current = await db.address.findUniqueOrThrow({ where: { id: second.id } });
    const defaults = await Promise.all([current, third].map((row) => addresses.PATCH(request("PATCH", revision(row)))));
    expect(defaults.every((response) => [200, 409].includes(response.status))).toBe(true);
    expect(await db.address.count({ where: { userId: owner.id, isDefault: true } })).toBe(1);
    expect((await db.address.findUniqueOrThrow({ where: { id: first.id } })).isDefault).toBe(false);
  });
  it("enforces the account cap under concurrent creation and pages all legacy addresses without a silent cap", async () => {
    await db.address.createMany({ data: Array.from({ length: 19 }, (_, index) => ({ ...fields(`Recipient ${index}`), userId: owner.id })) });
    const results = await Promise.all(["Twentieth recipient", "Overflow recipient"].map((name) => addresses.POST(request("POST", { fields: fields(name) }))));
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    await db.address.createMany({ data: Array.from({ length: 5 }, (_, index) => ({ ...fields(`Legacy ${index}`), userId: owner.id })) });
    const pages = await Promise.all([1, 2, 3].map(async (page) => (await addresses.GET(request("GET", undefined, `?page=${page}`))).json()));
    expect(pages.map((page) => page.addresses.length)).toEqual([10, 10, 5]);
    expect(new Set(pages.flatMap((page) => page.addresses.map((row: { id: string }) => row.id))).size).toBe(25);
    expect(pages[0].defaultAddress).toBeNull();
    expect((await addresses.POST(request("POST", { fields: fields() }))).status).toBe(409);
  });
  it("rolls back the old default and its revision if a new default insert fails in SQL", async () => {
    const saved = await create(); const constraint = `audit_address_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`ALTER TABLE "Address" ADD CONSTRAINT "${constraint}" CHECK (street <> 'audit-rejected-street')`);
    try {
      expect((await addresses.POST(request("POST", { fields: { ...fields(), street: "audit-rejected-street" }, makeDefault: true }))).status).toBe(503);
      expect(await db.address.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ isDefault: true, version: 1 });
      expect(await db.address.count({ where: { userId: owner.id } })).toBe(1);
    } finally { await db.$executeRawUnsafe(`ALTER TABLE "Address" DROP CONSTRAINT "${constraint}"`); }
  });
  it("coordinates profile-default revisions and prevents a stale profile save from overwriting a newly selected default", async () => {
    const first = await create(), second = await create("Office recipient");
    expect((await addresses.PATCH(request("PATCH", revision(second)))).status).toBe(200);
    const stale = await updateProfile(new Request("http://localhost/api/user/profile", { method: "PUT", body: JSON.stringify({ name: "Must roll back", address: fields("Stale recipient"), addressRevision: revision(first) }) }));
    expect(stale.status).toBe(409); expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).name).toBe(owner.name);
    const current = await db.address.findUniqueOrThrow({ where: { id: second.id } });
    const profile = await updateProfile(new Request("http://localhost/api/user/profile", { method: "PUT", body: JSON.stringify({ address: fields("Updated profile recipient"), addressRevision: revision(current) }) }));
    expect(profile.status).toBe(200);
    expect((await addresses.PUT(request("PUT", { ...revision(current), fields: fields("Stale editor") }))).status).toBe(409);
  });
  it("denies anonymous, revoked and rate-limited requests without changing stored addresses", async () => {
    const saved = await create();
    (getCurrentUser as jest.Mock).mockResolvedValue(null); expect((await addresses.GET(request("GET"))).status).toBe(401);
    expect((await addresses.DELETE(request("DELETE", revision(saved)))).status).toBe(401);
    (getCurrentUser as jest.Mock).mockResolvedValue(owner);
    await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await addresses.DELETE(request("DELETE", revision(saved)))).status).toBe(409);
    (rateLimit as jest.Mock).mockResolvedValue({ success: false });
    const limited = await addresses.POST(request("POST", { fields: fields() })); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
    expect(await db.address.count({ where: { userId: owner.id } })).toBe(1);
  });
  it("rechecks revocation after waiting on the actual owner-row lock", async () => {
    const saved = await create(); let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { arrived = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => { await tx.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } }); arrived(); await gate; }, { timeout: 10_000 });
    let mutation: Promise<Response> | undefined;
    try {
      await entered; mutation = addresses.PUT(request("PUT", { ...revision(saved), fields: fields("Revoked editor") }));
      const deadline = Date.now() + 3000; let waiting = false;
      while (Date.now() < deadline) {
        const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM "User"%'`;
        if (Number(row.total)) { waiting = true; break; } await delay(10);
      }
      expect(waiting).toBe(true); release(); await blocker; expect((await mutation).status).toBe(409);
      expect((await db.address.findUniqueOrThrow({ where: { id: saved.id } })).fullName).toBe(saved.fullName);
    } finally { release(); await blocker; await mutation; }
  });
  it("uses selected address values in a real server-priced order and preserves its shipping snapshot after address edits/deletion", async () => {
    const saved = await create("Actual order recipient");
    const seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    const category = await db.category.create({ data: { name: `${prefix}-category`, slug: `${prefix}-category` } });
    const product = await db.product.create({ data: { name: prefix, slug: `${prefix}-product`, price: 100, discountPrice: 80, stock: 2, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    let orderId: string | undefined;
    try {
      const selected = (await (await addresses.GET(request("GET"))).json()).addresses[0];
      const result = await createOrder({ fullName: selected.fullName, phone: selected.phone, street: selected.street, city: selected.city, district: selected.district, zipCode: selected.zipCode ?? "", items: [{ productId: product.id, quantity: 1 }], checkoutToken: "a".repeat(64), paymentMethod: "COD" });
      expect(result.success).toBe(true); if (!result.success) throw new Error("Order was not persisted"); orderId = result.orderId;
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.shippingAddress).toContain(saved.street); expect(order.shippingAddress).toContain(saved.fullName); expect(Number(order.total)).toBe(230); expect(order.paymentStatus).toBe("UNPAID");
      const edited = await addresses.PUT(request("PUT", { ...revision(saved), fields: fields("Later recipient") })); expect(edited.status).toBe(200);
      expect((await addresses.DELETE(request("DELETE", revision((await edited.json()).address)))).status).toBe(200);
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).shippingAddress).toBe(order.shippingAddress);
    } finally {
      await db.orderItem.deleteMany({ where: { productId: product.id } });
      if (orderId) await db.order.delete({ where: { id: orderId } });
      await db.product.delete({ where: { id: product.id } }); await db.category.delete({ where: { id: category.id } }); await db.user.delete({ where: { id: seller.id } });
    }
  });
});
