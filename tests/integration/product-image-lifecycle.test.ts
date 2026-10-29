jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Headers()) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn(() => "192.0.2.1"), rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient, User, Category, Product } from "@prisma/client";
import { getCurrentUserWithRole } from "@/lib/session";
import * as storage from "@/lib/cloudflare/r2";
import { replaceProductGallery } from "@/server/actions/product/gallery-actions";
import { adminDeleteProduct } from "@/server/actions/admin/admin-actions";
import { enqueueDetachedImages, processImageCleanupJobs } from "@/lib/product-image-lifecycle";
import { cleanupProductImages } from "@/lib/product-media-cleanup";
import { startS3MediaFixture, validLargePng } from "../helpers/s3-media-fixture";
import { POST as cleanupEndpoint } from "@/app/api/internal/media/cleanup/route";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("durable product gallery lifecycle with PostgreSQL and signed S3 HTTP", () => {
  let db: PrismaClient, seller: User, other: User, admin: User, category: Category, product: Product;
  let fixture: Awaited<ReturnType<typeof startS3MediaFixture>>, client: S3Client, store: ReturnType<typeof storage.createProductMediaStore>;
  let png: Buffer;
  const prefix = `audit-gallery-${randomUUID()}`;
  const key = () => `products/${seller.id}/${randomUUID()}.png`;
  const url = (key: string) => `https://cdn.media.example.invalid/${key}`;
  const existing = (url: string) => ({ source: "existing", url });
  const replace = (items: unknown[], version = 1, id = product.id) => replaceProductGallery({ productId: id, version, items });
  const due = (key: string) => db.productImageCleanup.create({ data: { key, ownerId: seller.id, availableAt: new Date(0) } });
  const upload = async () => {
    const prepared = await store.prepare({ ownerId: seller.id, size: png.length, contentType: "image/png" });
    expect((await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.headers, body: new Uint8Array(png) })).status).toBe(200);
    return prepared;
  };
  const age = (key: string) => { fixture.objects.get(`/fixture-media/${key}`)!.modified = new Date(Date.now() - 48 * 3600_000); };
  const publicGet = (key: string) => new Promise<{ status: number; type?: string; body: Buffer }>((resolve, reject) => {
    const req = httpRequest(`${fixture.endpoint}/${key}`, { headers: { Host: "cdn.media.example.invalid" } }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
      res.on("error", reject);
    }); req.on("error", reject); req.end();
  });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: "ADMIN", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    fixture = await startS3MediaFixture();
    client = new S3Client({ endpoint: fixture.endpoint, region: "auto", forcePathStyle: true, credentials: fixture.credentials, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
    store = storage.createProductMediaStore(client, "fixture-media", "https://cdn.media.example.invalid");
    jest.spyOn(storage, "productMediaStore").mockImplementation(() => store);
    png = validLargePng();
  });
  beforeEach(async () => {
    fixture.setAvailable(true); fixture.objects.clear();
    await db.productImageCleanup.deleteMany({ where: { ownerId: { in: [seller.id, other.id, admin.id] } } });
    await db.product.deleteMany({ where: { sellerId: { in: [seller.id, other.id] } } });
    const first = url(key()), second = url(key());
    product = await db.product.create({ data: { name: prefix, slug: `${prefix}-${randomUUID()}`, price: 100, stock: 1, sellerId: seller.id, categoryId: category.id, imageUrl: first, images: [first, second], status: "APPROVED" } });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller);
  });
  afterAll(async () => {
    jest.restoreAllMocks(); client?.destroy(); await fixture?.close();
    if (db) try {
      await db.productImageCleanup.deleteMany({ where: { ownerId: { in: [seller?.id, other?.id, admin?.id].filter(Boolean) } } });
      await db.product.deleteMany({ where: { sellerId: { in: [seller?.id, other?.id].filter(Boolean) } } });
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      if (category) await db.category.delete({ where: { id: category.id } });
    } finally { await db.$disconnect(); }
  });
  it("replaces with a decoded real upload, stores cover order, resets approval and queues detached owner keys atomically", async () => {
    const image = await upload();
    const result = await replace([{ source: "upload", key: image.fileKey }, existing(product.images[1])]);
    expect(result).toMatchObject({ success: true, data: { changed: true, version: 2, cleanupQueued: 1 } });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ imageUrl: image.publicUrl, images: [image.publicUrl, product.images[1]], status: "PENDING_APPROVAL", mediaVersion: 2 });
    const job = await db.productImageCleanup.findFirstOrThrow({ where: { ownerId: seller.id } });
    expect(job.key).toBe(new URL(product.images[0]).pathname.slice(1));
    expect(job.availableAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
  it("preserves approved no-op saves, rejects stale writes and never accepts unrelated retained URLs", async () => {
    expect(await replace(product.images.map(existing))).toMatchObject({ success: true, data: { changed: false, version: 1 } });
    expect((await replace([existing(url(key()))])).success).toBe(false);
    expect((await replace([existing(product.images[1])])).success).toBe(true);
    expect((await replace(product.images.map(existing))).success).toBe(false);
    expect(await db.productImageCleanup.count({ where: { ownerId: seller.id } })).toBe(1);
  });
  it("rejects foreign owners, unapproved/currently revoked sellers and foreign upload keys without storage verification", async () => {
    const spy = jest.spyOn(store, "verify");
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(other);
    expect((await replace(product.images.map(existing))).success).toBe(false);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue({ ...seller, sellerStatus: "BLOCKED" });
    expect((await replace(product.images.map(existing))).success).toBe(false);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller);
    await db.user.update({ where: { id: seller.id }, data: { sessionVersion: { increment: 1 } } });
    try { expect((await replace([existing(product.images[1])])).success).toBe(false); }
    finally { seller = await db.user.findUniqueOrThrow({ where: { id: seller.id } }); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(seller); }
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
    const head = jest.spyOn(store, "assertPresent");
    expect((await replace([{ source: "upload", key: `products/${other.id}/${randomUUID()}.png` }])).success).toBe(false);
    expect(head).not.toHaveBeenCalled(); head.mockRestore();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).mediaVersion).toBe(1);
  });
  it("treats the same key on old and new CDN domains as retained, and rolls queue writes back with a failed transaction", async () => {
    const retained = key(), detached = key();
    await db.$transaction((tx) => enqueueDetachedImages(tx, seller.id, [`https://old.example.invalid/${retained}`, url(detached)], [url(retained)]));
    expect(await db.productImageCleanup.findUnique({ where: { key: retained } })).toBeNull();
    expect(await db.productImageCleanup.findUnique({ where: { key: detached } })).not.toBeNull();
    const rolled = key();
    await expect(db.$transaction(async (tx) => { await enqueueDetachedImages(tx, seller.id, [url(rolled)], []); throw new Error("SQL rollback fixture"); })).rejects.toThrow("SQL rollback fixture");
    expect(await db.productImageCleanup.findUnique({ where: { key: rolled } })).toBeNull();
  });
  it("global admin deletion queues only the actual product owner's keys and FK rejection rolls back the queue", async () => {
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    const foreign = `products/${other.id}/${randomUUID()}.png`;
    await db.product.update({ where: { id: product.id }, data: { images: [...product.images, url(foreign), "https://images.example.invalid/external.png"] } });
    await db.wishlist.create({ data: { userId: other.id, productId: product.id } });
    try {
      expect((await adminDeleteProduct(product.id)).success).toBe(false);
      expect(await db.productImageCleanup.count({ where: { ownerId: seller.id } })).toBe(0);
      expect(await db.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    } finally { await db.wishlist.deleteMany({ where: { productId: product.id } }); }
    expect((await adminDeleteProduct(product.id)).success).toBe(true);
    const jobs = await db.productImageCleanup.findMany({ where: { ownerId: seller.id } });
    expect(jobs).toHaveLength(2); expect(jobs.every((job) => job.key.startsWith(`products/${seller.id}/`))).toBe(true);
    expect(await db.productImageCleanup.findUnique({ where: { key: foreign } })).toBeNull();
  });
  it("respects detach grace even in the broad orphan scan, and a dry-run mutates neither SQL nor storage", async () => {
    const image = await upload(); age(image.fileKey);
    await db.$transaction((tx) => enqueueDetachedImages(tx, seller.id, [image.publicUrl], []));
    expect((await processImageCleanupJobs(db, store, { apply: true })).inspected).toBe(0);
    expect((await cleanupProductImages(db, store, { apply: true })).removed).toBe(0);
    await db.productImageCleanup.update({ where: { key: image.fileKey }, data: { availableAt: new Date(0) } });
    const before = await db.productImageCleanup.findUniqueOrThrow({ where: { key: image.fileKey } });
    expect(await processImageCleanupJobs(db, store)).toMatchObject({ errors: 0, removed: 0, deferred: 1, dryRun: true });
    expect(await db.productImageCleanup.findUnique({ where: { key: image.fileKey } })).toEqual(before);
    expect(fixture.objects.has(`/fixture-media/${image.fileKey}`)).toBe(true);
    expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 0, removed: 1 });
    expect(fixture.objects.has(`/fixture-media/${image.fileKey}`)).toBe(false);
  });
  it("retains keys referenced through a historical CDN and defers freshly uploaded objects", async () => {
    const image = await upload(); age(image.fileKey); await due(image.fileKey);
    await db.product.update({ where: { id: product.id }, data: { images: [`https://previous.example.invalid/${image.fileKey}`] } });
    expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 0, retained: 1 });
    expect(fixture.objects.has(`/fixture-media/${image.fileKey}`)).toBe(true);
    const fresh = await upload(); await due(fresh.fileKey);
    expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 0, deferred: 1 });
    expect((await db.productImageCleanup.findUniqueOrThrow({ where: { key: fresh.fileKey } })).availableAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
  it("serves the exact uploaded bytes through the configured custom CDN key and returns 404 after cleanup", async () => {
    const image = await upload();
    expect(image.publicUrl).toBe(`https://cdn.media.example.invalid/${image.fileKey}`);
    const delivered = await publicGet(image.fileKey);
    expect(delivered.status).toBe(200); expect(delivered.type).toBe("image/png"); expect(delivered.body.equals(png)).toBe(true);
    age(image.fileKey); await due(image.fileKey);
    expect((await processImageCleanupJobs(db, store, { apply: true })).removed).toBe(1);
    expect((await publicGet(image.fileKey)).status).toBe(404);
  });
  it("retries provider failure without exposing details and clears an exact provider 404 idempotently", async () => {
    const image = await upload(); age(image.fileKey); await due(image.fileKey);
    fixture.setAvailable(false);
    expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 1, removed: 0 });
    const job = await db.productImageCleanup.findUniqueOrThrow({ where: { key: image.fileKey } });
    expect(job.attempts).toBe(1); expect(job.lastError).toBe("Storage or cleanup transaction unavailable");
    fixture.setAvailable(true); fixture.objects.delete(`/fixture-media/${image.fileKey}`);
    await db.productImageCleanup.update({ where: { key: image.fileKey }, data: { availableAt: new Date(0) } });
    expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 0, missing: 1 });
    expect((await processImageCleanupJobs(db, store, { apply: true })).inspected).toBe(0);
  });
  it("serializes concurrent workers so the same queued object is deleted once", async () => {
    const image = await upload(); age(image.fileKey); await due(image.fileKey);
    const spy = jest.spyOn(store, "removeUnused");
    try {
      const results = await Promise.all([processImageCleanupJobs(db, store, { apply: true }), processImageCleanupJobs(db, store, { apply: true })]);
      expect(results.reduce((sum, result) => sum + result.removed, 0)).toBe(1);
      expect(results.every((result) => result.errors === 0)).toBe(true); expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  it("recovers a provider delete followed by a failed SQL transaction through an exact-404 retry", async () => {
    const image = await upload(); age(image.fileKey); await due(image.fileKey);
    const remove = store.removeUnused.bind(store);
    const spy = jest.spyOn(store, "removeUnused").mockImplementationOnce(async (key) => { await remove(key); throw new Error("Failure after provider success fixture"); });
    try {
      expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 1, removed: 0 });
      expect(fixture.objects.has(`/fixture-media/${image.fileKey}`)).toBe(false);
      expect(await db.productImageCleanup.findUnique({ where: { key: image.fileKey } })).not.toBeNull();
      await db.productImageCleanup.update({ where: { key: image.fileKey }, data: { availableAt: new Date(0) } });
      expect(await processImageCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 0, missing: 1 });
    } finally { spy.mockRestore(); }
  });
  it("enforces owner/key and positive version constraints in actual SQL", async () => {
    await expect(db.productImageCleanup.create({ data: { key: key(), ownerId: other.id, availableAt: new Date() } })).rejects.toThrow();
    await expect(db.product.update({ where: { id: product.id }, data: { mediaVersion: 0 } })).rejects.toThrow();
  });
  it("keeps a queued image when replacement wins the owner lock, and denies replacement when cleanup wins", async () => {
    const waitForLock = async () => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM "User"%'`;
        if (Number(row.total) > 0) return; await delay(10);
      }
      throw new Error("Expected a real competing owner-row lock");
    };
    for (const editWins of [true, false]) {
      const image = await upload(); age(image.fileKey); await due(image.fileKey);
      let arrived!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => { arrived = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const present = store.assertPresent.bind(store), remove = store.removeUnused.bind(store);
      const spy = editWins
        ? jest.spyOn(store, "assertPresent").mockImplementationOnce(async (images, owner) => { const urls = await present(images, owner); arrived(); await gate; return urls; })
        : jest.spyOn(store, "removeUnused").mockImplementationOnce(async (key) => { arrived(); await gate; await remove(key); });
      let edit: ReturnType<typeof replace> | undefined, cleanup: ReturnType<typeof processImageCleanupJobs> | undefined;
      const version = (await db.product.findUniqueOrThrow({ where: { id: product.id } })).mediaVersion;
      try {
        if (editWins) edit = replace([{ source: "upload", key: image.fileKey }], version);
        else cleanup = processImageCleanupJobs(db, store, { apply: true });
        await entered;
        if (editWins) cleanup = processImageCleanupJobs(db, store, { apply: true });
        else edit = replace([{ source: "upload", key: image.fileKey }], version);
        await waitForLock(); release();
        expect((await edit!).success).toBe(editWins); expect((await cleanup!).errors).toBe(0);
        expect(fixture.objects.has(`/fixture-media/${image.fileKey}`)).toBe(editWins);
      } finally { release(); await edit; await cleanup; spy.mockRestore(); }
    }
  });
  it("requires maintenance auth and an exact database target before storage access", async () => {
    const saved = { secret: process.env.CHECKOUT_SWEEP_SECRET, database: process.env.MEDIA_CLEANUP_DATABASE };
    process.env.CHECKOUT_SWEEP_SECRET = "isolated-maintenance-test-key-".repeat(2);
    process.env.MEDIA_CLEANUP_DATABASE = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
    const spy = jest.spyOn(storage, "productMediaStore"); spy.mockClear();
    const request = (auth?: string) => new Request("http://localhost/api/internal/media/cleanup", { method: "POST", headers: auth ? { authorization: `Bearer ${auth}` } : {} });
    try {
      expect((await cleanupEndpoint(request())).status).toBe(401); expect(spy).not.toHaveBeenCalled();
      process.env.MEDIA_CLEANUP_DATABASE = "audit_wrong_target";
      expect((await cleanupEndpoint(request(process.env.CHECKOUT_SWEEP_SECRET))).status).toBe(503); expect(spy).not.toHaveBeenCalled();
      process.env.MEDIA_CLEANUP_DATABASE = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
      const response = await cleanupEndpoint(request(process.env.CHECKOUT_SWEEP_SECRET));
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ inspected: 0, dryRun: false });
    } finally {
      if (saved.secret === undefined) delete process.env.CHECKOUT_SWEEP_SECRET; else process.env.CHECKOUT_SWEEP_SECRET = saved.secret;
      if (saved.database === undefined) delete process.env.MEDIA_CLEANUP_DATABASE; else process.env.MEDIA_CLEANUP_DATABASE = saved.database;
    }
  });
});
