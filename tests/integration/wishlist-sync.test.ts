jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient, User, Product, Category } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import * as wishlist from "@/app/api/wishlist/route";
import { POST as guest } from "@/app/api/wishlist/guest/route";
const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("private wishlist API with actual PostgreSQL ownership and races", () => {
  let db: PrismaClient, owner: User, other: User, seller: User, category: Category, products: Product[];
  const prefix = `audit-wishlist-${randomUUID()}`;
  const request = (method = "GET", body?: unknown, ownerId = owner.id, query = "") => new Request(`http://localhost/api/wishlist${query}`, { method, headers: { "X-Wishlist-Owner": ownerId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const read = async (page = 1) => (await wishlist.GET(request("GET", undefined, owner.id, `?page=${page}`))).json();
  const add = (productIds: string[], merge = false) => wishlist.POST(request("POST", { productIds, merge }));
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    await db.product.createMany({ data: Array.from({ length: 203 }, (_, index) => ({ id: randomUUID(), name: `${prefix}-${index}`, slug: `${prefix}-${index}`, price: 100, discountPrice: 80, stock: 2, status: "APPROVED", sellerId: seller.id, categoryId: category.id })) });
    products = await db.product.findMany({ where: { sellerId: seller.id }, orderBy: { slug: "asc" } });
  });
  beforeEach(async () => {
    await db.wishlist.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
    owner = await db.user.update({ where: { id: owner.id }, data: { wishlistVersion: 0 } });
    await db.product.updateMany({ where: { sellerId: seller.id }, data: { status: "APPROVED", price: 100, discountPrice: 80, stock: 2, imageUrl: null } });
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } });
    (getCurrentUser as jest.Mock).mockResolvedValue(owner); (rateLimit as jest.Mock).mockResolvedValue({ success: true });
  });
  afterAll(async () => { if (db) try {
    const ids = [owner?.id, other?.id, seller?.id].filter(Boolean);
    await db.wishlist.deleteMany({ where: { userId: { in: ids } } });
    if (seller) await db.product.deleteMany({ where: { sellerId: seller.id } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  } finally { await db.$disconnect(); } });
  it("adds idempotently, returns current catalog values privately, and removes idempotently", async () => {
    expect((await add([products[0].id])).status).toBe(200); expect((await add([products[0].id])).status).toBe(200);
    let snapshot = await read(); expect(snapshot).toMatchObject({ ownerId: owner.id, version: 1, total: 1 });
    expect(snapshot.items[0]).toMatchObject({ id: products[0].id, product: { price: 100, discountPrice: 80, stock: 2, category: category.name } });
    await db.product.update({ where: { id: products[0].id }, data: { price: 120, stock: 0 } }); snapshot = await read(); expect(snapshot.items[0].product).toMatchObject({ price: 120, stock: 0 });
    const response = await wishlist.GET(request()); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toContain(owner.email);
    for (let retry = 0; retry < 2; retry++) expect((await wishlist.DELETE(request("DELETE", { productIds: [products[0].id] }))).status).toBe(200);
    expect(await read()).toMatchObject({ total: 0, version: 2 });
  });
  it("keeps two sessions consistent without overwriting additions from another session", async () => {
    await Promise.all([add([products[0].id]), add([products[1].id])]);
    const a = await read(), b = await read(); expect(a.items.map((item: { id: string }) => item.id).sort()).toEqual([products[0].id, products[1].id].sort()); expect(a).toEqual(b); expect(a.version).toBe(2);
    await Promise.all([add([products[2].id]), wishlist.DELETE(request("DELETE", { productIds: [products[0].id] }))]);
    expect((await read()).items.map((item: { id: string }) => item.id).sort()).toEqual([products[1].id, products[2].id].sort());
  });
  it("serializes duplicate concurrent adds and increments revision once", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => add([products[0].id]))); expect(results.every((response) => response.status === 200)).toBe(true);
    expect(await read()).toMatchObject({ total: 1, version: 1 });
  });
  it("guards the actual session owner against stale queued requests and never reads or removes a foreign list", async () => {
    await add([products[0].id]); (getCurrentUser as jest.Mock).mockResolvedValue(other);
    for (const response of [await wishlist.GET(request()), await wishlist.POST(request("POST", { productIds: [products[1].id] })), await wishlist.DELETE(request("DELETE", { productIds: [products[0].id] }))]) expect(response.status).toBe(409);
    const own = await wishlist.GET(request("GET", undefined, other.id)); expect((await own.json()).total).toBe(0);
    expect(await db.wishlist.count({ where: { userId: owner.id } })).toBe(1);
  });
  it("rejects owner/mass assignment, invalid requests, excessive input and malformed pages", async () => {
    for (const body of [{ productIds: [] }, { productIds: [products[0].id, products[0].id] }, { productIds: [products[0].id], userId: other.id }, { productIds: [products[0].id], price: 1 }, { productIds: ["x".repeat(65)] }]) expect((await wishlist.POST(request("POST", body))).status).toBe(400);
    expect((await wishlist.POST(new Request("http://localhost/api/wishlist", { method: "POST", headers: { "X-Wishlist-Owner": owner.id }, body: "x".repeat(16_385) }))).status).toBe(413);
    for (const query of ["?page=0", "?page=1&page=2", "?page=-1", "?userId=another", "?page=1000001"]) expect((await wishlist.GET(request("GET", undefined, owner.id, query))).status).toBe(400);
    expect(await db.wishlist.count({ where: { userId: owner.id } })).toBe(0);
  });
  it("merges additively, reports skipped unavailable IDs and retains hidden saved references without disclosing metadata", async () => {
    await add([products[0].id]); await db.product.update({ where: { id: products[1].id }, data: { status: "PENDING_APPROVAL" } });
    expect((await add([products[2].id, products[1].id])).status).toBe(409); expect((await read()).total).toBe(1);
    const response = await add([products[0].id, products[1].id, products[2].id, randomUUID()], true); expect(response.status).toBe(200); const merged = await response.json(); expect(merged.acceptedIds.sort()).toEqual([products[0].id, products[2].id].sort()); expect(merged.skippedIds).toContain(products[1].id);
    await db.product.update({ where: { id: products[0].id }, data: { status: "REJECTED" } });
    const snapshot = await read(); expect(snapshot.items.find((row: { id: string }) => row.id === products[0].id).product).toBeNull(); expect(JSON.stringify(snapshot)).not.toContain(products[0].name);
    expect((await wishlist.DELETE(request("DELETE", { productIds: [products[0].id] }))).status).toBe(200);
  });
  it("resolves guest IDs only through public products and rejects supplied cached price/name fields", async () => {
    await db.product.update({ where: { id: products[0].id }, data: { imageUrl: "https://cdn.example.invalid/image.png?X-Amz-Signature=private" } });
    await db.product.update({ where: { id: products[1].id }, data: { status: "PENDING_APPROVAL" } });
    const body = { productIds: [products[0].id, products[1].id] };
    const response = await guest(new Request("http://localhost/api/wishlist/guest", { method: "POST", body: JSON.stringify(body) })); expect(response.status).toBe(200); const data = await response.json();
    expect(data.items[0].product.imageUrl).toBeNull(); expect(data.items[1].product).toBeNull(); expect(data.ownerId).toBeUndefined();
    expect((await guest(new Request("http://localhost/api/wishlist/guest", { method: "POST", body: JSON.stringify({ ...body, price: 1 }) }))).status).toBe(400);
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } });
    expect((await (await guest(new Request("http://localhost/api/wishlist/guest", { method: "POST", body: JSON.stringify(body) }))).json()).items.every((row: { product: unknown }) => row.product === null)).toBe(true);
  });
  it("requires the observed revision to clear so a stale device cannot remove new additions", async () => {
    await add([products[0].id]); const old = await read(); await add([products[1].id]);
    expect((await wishlist.DELETE(request("DELETE", { clear: true, version: old.version }))).status).toBe(409); expect((await read()).total).toBe(2);
    expect((await wishlist.DELETE(request("DELETE", { clear: true, version: (await read()).version }))).status).toBe(200); expect((await read()).total).toBe(0);
  });
  it("enforces the 200-item cap under concurrency and keeps legacy rows fully paginated", async () => {
    await db.wishlist.createMany({ data: products.slice(0, 199).map((product) => ({ userId: owner.id, productId: product.id })) });
    const results = await Promise.all([add([products[199].id]), add([products[200].id])]); expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    await db.wishlist.createMany({ data: products.map((product) => ({ userId: owner.id, productId: product.id })), skipDuplicates: true });
    const a = await read(1), b = await read(2); expect(a.items).toHaveLength(200); expect(b.items).toHaveLength(3); expect(a.total).toBe(203); expect(a.totalPages).toBe(2); expect(new Set([...a.items, ...b.items].map((row) => row.id)).size).toBe(203);
    expect((await add([products[0].id])).status).toBe(200);
  });
  it("rolls back a failed SQL batch without advancing the wishlist revision", async () => {
    const constraint = `audit_wishlist_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`ALTER TABLE "Wishlist" ADD CONSTRAINT "${constraint}" CHECK ("productId" <> '${products[1].id}')`);
    try { expect((await add([products[0].id, products[1].id])).status).toBe(503); expect(await read()).toMatchObject({ total: 0, version: 0 }); }
    finally { await db.$executeRawUnsafe(`ALTER TABLE "Wishlist" DROP CONSTRAINT "${constraint}"`); }
  });
  it("rejects anonymous/revoked sessions and rate limits before writes", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null); expect((await wishlist.GET(request())).status).toBe(401); expect((await add([products[0].id])).status).toBe(401);
    (getCurrentUser as jest.Mock).mockResolvedValue(owner); await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } }); expect((await add([products[0].id])).status).toBe(409);
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); const limited = await add([products[0].id]); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60"); expect((await read()).success).toBe(false);
  });
  it("rechecks authority after waiting on the actual owner lock", async () => {
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { arrived = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => { await tx.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } }); arrived(); await gate; }, { timeout: 10_000 });
    let mutation: Promise<Response> | undefined;
    try {
      await entered; mutation = add([products[0].id]); let waiting = false; const deadline = Date.now() + 3000;
      while (Date.now() < deadline) { const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM "User"%'`; if (Number(row.total)) { waiting = true; break; } await delay(10); }
      expect(waiting).toBe(true); release(); await blocker; expect((await mutation).status).toBe(409); expect(await db.wishlist.count({ where: { userId: owner.id } })).toBe(0);
    } finally { release(); await blocker; await mutation; }
  });
});
