jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn(), getCurrentUser: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Headers()) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn(() => "192.0.2.1"), rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient, User, Category } from "@prisma/client";
import { getCurrentUserWithRole } from "@/lib/session";
import * as storage from "@/lib/cloudflare/r2";
import { createProduct } from "@/server/actions/product/product-actions";
import { POST } from "@/app/api/upload/route";
import { startS3MediaFixture, validLargePng } from "../helpers/s3-media-fixture";
import { cleanupProductImages } from "@/lib/product-media-cleanup";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import * as decoder from "@/lib/validate-product-image";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("direct product media: actual SigV4 HTTP, SQL and application handlers", () => {
  let db: PrismaClient, seller: User, category: Category;
  let fixture: Awaited<ReturnType<typeof startS3MediaFixture>>, store: ReturnType<typeof storage.createProductMediaStore>, client: S3Client;
  const prefix = `audit-media-${randomUUID()}`;
  let png: Buffer;
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Use an isolated local audit_* database");
    process.env.DATABASE_URL = url.toString();
    db = (await import("@/lib/prisma")).prisma;
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    fixture = await startS3MediaFixture();
    client = new S3Client({ endpoint: fixture.endpoint, region: "auto", forcePathStyle: true, credentials: fixture.credentials, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
    store = storage.createProductMediaStore(client, "fixture-media", "https://media.example.invalid");
    jest.spyOn(storage, "productMediaStore").mockImplementation(() => store);
    jest.spyOn(storage, "generatePresignedUploadUrl").mockImplementation((input) => store.prepare(input));
    png = validLargePng();
  }, 30_000);
  beforeEach(() => { (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller); fixture.setAvailable(true); });
  afterAll(async () => {
    jest.restoreAllMocks(); client?.destroy(); await fixture?.close();
    if (db) try { await db.product.deleteMany({ where: { sellerId: seller?.id } }); if (seller) await db.user.delete({ where: { id: seller.id } }); if (category) await db.category.delete({ where: { id: category.id } }); } finally { await db.$disconnect(); }
  });
  const request = (body: unknown) => new Request("http://localhost/api/upload", { method: "POST", body: JSON.stringify(body) });
  const input = (uploadKeys: string[]) => ({ name: prefix, price: 100, stock: 1, categoryId: category.id, images: [], uploadKeys, isFeatured: false });
  const upload = async (body = png, contentType = "image/png") => {
    const response = await POST(request({ contentType, size: body.length }));
    expect(response.status).toBe(200);
    const prepared = await response.json();
    expect((await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.headers, body: new Uint8Array(body) })).status).toBe(200);
    return prepared;
  };
  it("uploads a valid 2–5 MiB PNG directly and persists ordered public gallery URLs without inline bytes", async () => {
    expect(png.length).toBeGreaterThan(2 * 1024 * 1024); expect(png.length).toBeLessThan(5 * 1024 * 1024);
    const first = await upload(), second = await upload();
    const keys = [second.fileKey, first.fileKey];
    expect(Buffer.byteLength(JSON.stringify(input(keys)))).toBeLessThan(2048);
    const result = await createProduct({ ...input(keys), specifications: [{ label: "Screen", value: "OLED" }] });
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("Product was not persisted");
    const saved = await db.product.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.images).toEqual([second.publicUrl, first.publicUrl]); expect(saved.imageUrl).toBe(second.publicUrl);
    expect(saved.status).toBe("PENDING_APPROVAL"); expect(saved.sellerId).toBe(seller.id);
    expect(saved.specifications).toEqual([{ label: "Screen", value: "OLED" }]);
    expect(JSON.stringify(result)).not.toContain("data:image");
  });
  it("uses five-minute signed size/type/create-only uploads and blocks changed headers and overwrite", async () => {
    const prepared = await upload();
    const url = new URL(prepared.uploadUrl);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    for (const header of ["content-length", "content-type", "if-none-match"]) expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain(header);
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect((await fetch(prepared.uploadUrl, { method: "PUT", headers: { ...prepared.headers, "Content-Type": "image/jpeg" }, body: new Uint8Array(png) })).status).toBe(403);
    expect((await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.headers, body: new Uint8Array(png) })).status).toBe(412);
  });
  it("denies anonymous and unapproved uploads, oversized/invalid types and caller-selected identities", async () => {
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await POST(request({}))).status).toBe(401);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ ...seller, sellerStatus: "BLOCKED" }); expect((await POST(request({}))).status).toBe(403);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller);
    for (const data of [{ contentType: "image/svg+xml", size: 50 }, { contentType: "image/png", size: 5 * 1024 * 1024 + 1 }, { contentType: "image/png", size: 10, ownerId: "other" }]) expect((await POST(request(data))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/upload", { method: "POST", body: "x".repeat(2048) }))).status).toBe(413);
  });
  it("rejects cross-account, missing, duplicate, data-URL and falsely typed objects before a product write", async () => {
    const prepared = await upload();
    const before = await db.product.count({ where: { sellerId: seller.id } });
    const fake = await upload(Buffer.from("<script>not a PNG</script>"));
    for (const keys of [[], [prepared.fileKey.replace(seller.id, randomUUID())], [prepared.fileKey, prepared.fileKey], [`products/${seller.id}/${randomUUID()}.png`], [fake.fileKey]]) expect((await createProduct(input(keys))).success).toBe(false);
    expect((await createProduct({ ...input([prepared.fileKey]), imageUrl: "data:image/png;base64,AAAA" })).success).toBe(false);
    expect(await db.product.count({ where: { sellerId: seller.id } })).toBe(before);
  });
  it("reports storage outage without fake success or a partial product row", async () => {
    fixture.setAvailable(false);
    expect((await createProduct(input([`products/${seller.id}/${randomUUID()}.png`]))).success).toBe(false);
  });
  it("decodes real JPEG and WebP pixels and refuses truncated, disguised or over-limit rasters", async () => {
    for (const [format, type] of [["jpeg", "image/jpeg"], ["webp", "image/webp"]] as const) {
      const prepared = await upload(await sharp(png).toFormat(format).toBuffer(), type);
      expect((await createProduct(input([prepared.fileKey]))).success).toBe(true);
    }
    const oversized = await sharp({ create: { width: 4001, height: 4001, channels: 3, background: "white" } }).png().toBuffer();
    expect((await sharp(oversized).metadata()).width).toBe(4001);
    for (const body of [png.subarray(0, 32), png.subarray(0, png.length / 2), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), oversized]) {
      const prepared = await upload(body);
      expect((await createProduct(input([prepared.fileKey]))).success).toBe(false);
    }
  });
  it("uses the seller form's actual action for administrators too and never autoapproves their new products", async () => {
    const prepared = await upload();
    const admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: "ADMIN", isVerified: true } });
    try {
      (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
      expect((await createProduct(input([prepared.fileKey]))).success).toBe(false);
      const own = await upload();
      expect((await createProduct({ ...input([own.fileKey]), isFeatured: true })).success).toBe(true);
      const saved = await db.product.findFirstOrThrow({ where: { imageUrl: own.publicUrl } });
      expect(saved.status).toBe("PENDING_APPROVAL"); expect(saved.sellerId).toBe(admin.id); expect(saved.isFeatured).toBe(true);
    } finally {
      await db.product.deleteMany({ where: { sellerId: admin.id } }); await db.user.delete({ where: { id: admin.id } });
    }
  });
  it("returns the committed product identity after cache refresh failure instead of a false creation failure", async () => {
    const prepared = await upload();
    (revalidatePath as jest.Mock).mockImplementationOnce(() => { throw new Error("Cache unavailable fixture"); });
    const result = await createProduct(input([prepared.fileKey]));
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("Expected the committed identity");
    expect(await db.product.count({ where: { id: result.data.id, sellerId: seller.id, imageUrl: prepared.publicUrl, status: "PENDING_APPROVAL" } })).toBe(1);
  });
  it("rejects direct mass assignment, invalid references and account-budget denial before image processing", async () => {
    const prepared = await upload();
    const spy = jest.spyOn(store, "verify");
    try {
      for (const changes of [{ sellerId: randomUUID() }, { status: "APPROVED" }, { isFeatured: true }, { price: "100" }, { discountPrice: 150 }, { stock: 1.3 }, { name: "x".repeat(121) }, { description: "x".repeat(20_001) }, { categoryId: randomUUID() }, { brandId: randomUUID() }]) expect((await createProduct({ ...input([prepared.fileKey]), ...changes })).success).toBe(false);
      (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false });
      const denied = await createProduct(input([prepared.fileKey]));
      expect(denied).toMatchObject({ success: false, retryAfter: 60 });
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("rechecks the verified object's ETag under the publication lock", async () => {
    const prepared = await upload();
    const verify = store.verify.bind(store);
    const spy = jest.spyOn(store, "verify").mockImplementationOnce(async (keys, owner) => {
      const images = await verify(keys, owner);
      fixture.objects.get(`/fixture-media/${prepared.fileKey}`)!.etag = '"changed-after-validation"';
      return images;
    });
    try { expect((await createProduct(input([prepared.fileKey]))).success).toBe(false); expect(await db.product.count({ where: { imageUrl: prepared.publicUrl } })).toBe(0); }
    finally { spy.mockRestore(); }
  });
  it("bounds real decode workload to two batches without accumulating a waiting queue", async () => {
    const prepared = await upload();
    let arrived!: () => void, release!: () => void, count = 0;
    const entered = new Promise<void>((resolve) => { arrived = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const realDecode = decoder.decodeProductImage;
    const spy = jest.spyOn(decoder, "decodeProductImage").mockImplementation(async (bytes, type) => { await realDecode(bytes, type); if (++count === 2) arrived(); await gate; });
    const first = store.verify([prepared.fileKey], seller.id), second = store.verify([prepared.fileKey], seller.id);
    try { await entered; await expect(store.verify([prepared.fileKey], seller.id)).rejects.toThrow(/busy/); }
    finally { release(); await Promise.all([first, second]); spy.mockRestore(); }
  });
  it("rechecks current seller authority before publishing already uploaded images", async () => {
    const prepared = await upload();
    const before = await db.product.count({ where: { sellerId: seller.id } });
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } });
    try { expect((await createProduct(input([prepared.fileKey]))).success).toBe(false); expect(await db.product.count({ where: { sellerId: seller.id } })).toBe(before); }
    finally { seller = await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } }); }
  });
  it("dry-runs unused cleanup and removes only old unreferenced objects with actual signed DELETEs", async () => {
    const existing = await db.product.findFirstOrThrow({ where: { sellerId: seller.id } });
    await db.product.update({ where: { id: existing.id }, data: { imageUrl: existing.imageUrl?.replace("media.example.invalid", "previous-cdn.example.invalid"), images: existing.images.map((url) => url.replace("media.example.invalid", "previous-cdn.example.invalid")) } });
    fixture.objects.forEach((object) => { object.modified = new Date(Date.now() - 48 * 60 * 60 * 1000); });
    const fresh = await upload();
    const before = fixture.objects.size;
    const dry = await cleanupProductImages(db, store);
    expect(dry.errors).toBe(0); expect(dry.unused).toBeGreaterThan(0); expect(dry.removed).toBe(0); expect(fixture.objects.size).toBe(before);
    const result = await cleanupProductImages(db, store, { apply: true });
    expect(result.errors).toBe(0); expect(result.removed).toBe(dry.unused);
    expect(fixture.objects.has(`/fixture-media/${fresh.fileKey}`)).toBe(true);
    for (const product of await db.product.findMany({ where: { sellerId: seller.id } })) for (const url of product.images) expect(fixture.objects.has(`/fixture-media${new URL(url).pathname}`)).toBe(true);
  });
  const waitForOwnerLock = async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const waiting = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM "User"%'`;
      if (Number(waiting[0].total) > 0) return;
      await delay(10);
    }
    throw new Error("Expected a real competing owner-row lock");
  };
  it("retains an old image when product creation wins the real cleanup row-lock race", async () => {
    const prepared = await upload();
    fixture.objects.get(`/fixture-media/${prepared.fileKey}`)!.modified = new Date(Date.now() - 48 * 60 * 60 * 1000);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { arrived = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const verify = store.assertPresent.bind(store);
    const spy = jest.spyOn(store, "assertPresent").mockImplementationOnce(async (images, owner) => { const urls = await verify(images, owner); arrived(); await gate; return urls; });
    const creation = createProduct(input([prepared.fileKey]));
    let cleanup: ReturnType<typeof cleanupProductImages> | undefined;
    try {
      await entered; cleanup = cleanupProductImages(db, store, { apply: true });
      await waitForOwnerLock(); release();
      expect((await creation).success).toBe(true); expect((await cleanup).errors).toBe(0);
      expect(fixture.objects.has(`/fixture-media/${prepared.fileKey}`)).toBe(true);
    } finally { release(); await creation; await cleanup; spy.mockRestore(); }
  });
  it("rejects publication when unused cleanup wins the real owner-row lock race", async () => {
    const prepared = await upload();
    fixture.objects.get(`/fixture-media/${prepared.fileKey}`)!.modified = new Date(Date.now() - 48 * 60 * 60 * 1000);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { arrived = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const remove = store.removeUnused.bind(store);
    const spy = jest.spyOn(store, "removeUnused").mockImplementationOnce(async (key) => { arrived(); await gate; await remove(key); });
    const cleanup = cleanupProductImages(db, store, { apply: true });
    let creation: ReturnType<typeof createProduct> | undefined;
    try {
      await entered; creation = createProduct(input([prepared.fileKey]));
      await waitForOwnerLock(); release();
      expect((await cleanup).errors).toBe(0); expect((await creation).success).toBe(false);
      expect(fixture.objects.has(`/fixture-media/${prepared.fileKey}`)).toBe(false);
    } finally { release(); await cleanup; await creation; spy.mockRestore(); }
  });
});
