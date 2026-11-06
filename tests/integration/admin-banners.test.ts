import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { startS3MediaFixture } from "@/tests/helpers/s3-media-fixture";
import * as storage from "@/lib/cloudflare/r2";
import { mutateBanner, readBanners } from "@/lib/admin-banners";
import { getHomepageBanners } from "@/lib/homepage-banners";
import { processImageCleanupJobs } from "@/lib/product-image-lifecycle";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { BannerFields } from "@/lib/validations/banner";
const fields = (data: Partial<BannerFields> = {}): BannerFields => ({ title: `Banner ${randomUUID()}`, subtitle: null, linkUrl: "/products", placement: "HERO", position: 0, isActive: false, ...data });
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("banner operations with actual PostgreSQL and signed S3 HTTP", () => {
  let database: Awaited<ReturnType<typeof createFinanceDatabase>>, fixture: Awaited<ReturnType<typeof startS3MediaFixture>>, client: S3Client, store: ReturnType<typeof storage.createProductMediaStore>, image: Buffer;
  let admin: User, second: User, seller: User;
  beforeAll(async () => {
    database = await createFinanceDatabase(); mockDatabase = database.db; fixture = await startS3MediaFixture(); client = new S3Client({ endpoint: fixture.endpoint, forcePathStyle: true, region: "auto", credentials: fixture.credentials, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
    store = storage.createProductMediaStore(client, "fixture-media", "https://cdn.media.example.invalid"); jest.spyOn(storage, "productMediaStore").mockReturnValue(store);
    image = await sharp({ create: { width: 50, height: 30, channels: 4, background: "blue" } }).png().toBuffer();
    [admin, second, seller] = await Promise.all(["ADMIN", "ADMIN", "MEMBER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@banner.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
  }, 30_000);
  beforeEach(() => { jest.clearAllMocks(); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); });
  afterAll(async () => { jest.restoreAllMocks(); client?.destroy(); await fixture?.close(); await database?.close(); });
  const upload = async (owner = admin, bytes = image) => { const file = await store.prepare({ ownerId: owner.id, contentType: "image/png", size: bytes.length }); expect((await fetch(file.uploadUrl, { method: "PUT", headers: file.headers, body: new Uint8Array(bytes) })).status).toBe(200); return file; };
  const create = async (data: Partial<BannerFields> = {}) => { const file = await upload(); return mutateBanner(admin, { action: "create", requestId: randomUUID(), fields: fields(data), uploadKey: file.fileKey }); };
  it("publishes actual verified bytes, recovers exact receipts after deletion and retains actor history", async () => {
    const file = await upload(), input = { action: "create", requestId: randomUUID(), fields: fields(), uploadKey: file.fileKey }, result = await mutateBanner(admin, input);
    expect(result.row?.imageUrl).toBe(file.publicUrl); expect(await mutateBanner(admin, input)).toEqual(result);
    await expect(mutateBanner(second, input)).rejects.toMatchObject({ code: "BANNER_IMAGE_OWNER" });
    await expect(mutateBanner(admin, { ...input, fields: { ...input.fields, title: "Changed intent" } })).rejects.toMatchObject({ code: "BANNER_REQUEST_CONFLICT" });
    const deletion = { action: "delete", requestId: randomUUID(), id: result.result.id, version: 1 };
    const deleted = await mutateBanner(admin, deletion); expect(await mutateBanner(admin, deletion)).toEqual(deleted);
    expect(await mutateBanner(admin, input)).toMatchObject({ result: { deleted: false }, row: null, currentDeleted: true });
    const lookup = await readBanners(admin, { q: "no-match", requestId: input.requestId }); expect(lookup.attempt?.id).toBe(result.result.id); expect(lookup.attemptedDeleted).toBe(true);
    const history = await readBanners(admin, { mode: "history", id: result.result.id }); expect(history.events.map((event) => event.action)).toEqual(["DELETE", "CREATE"]); expect(history.events.every((event) => event.actorId === admin.id)).toBe(true);
    await expect(mockDatabase.bannerRequest.delete({ where: { id: input.requestId } })).rejects.toThrow();
  });
  it("renders ordered placement data from saved activation/position edits and rejects stale concurrent revisions", async () => {
    const a = await create({ isActive: true, position: 20 }), b = await create({ isActive: true, position: 10 }), promo = await create({ placement: "PROMO", isActive: true }), ad = await create({ placement: "AD", isActive: true });
    const publicData = await getHomepageBanners(); expect(publicData.HERO.map((row) => row.id)).toEqual([b.result.id, a.result.id]); expect(publicData.PROMO.map((row) => row.id)).toEqual([promo.result.id]); expect(publicData.AD.map((row) => row.id)).toEqual([ad.result.id]);
    const update = { action: "update", id: a.result.id, version: 1, fields: fields({ title: a.row!.title, position: 1, isActive: true }) };
    const outcomes = await Promise.allSettled([mutateBanner(admin, { ...update, requestId: randomUUID() }), mutateBanner(second, { ...update, requestId: randomUUID() })]); expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1); expect(outcomes.find((value) => value.status === "rejected")).toMatchObject({ reason: { code: "BANNER_CHANGED" } });
    expect((await getHomepageBanners()).HERO[0].id).toBe(a.result.id);
    await mutateBanner(admin, { action: "activation", requestId: randomUUID(), id: a.result.id, version: 2, isActive: false }); expect((await getHomepageBanners()).HERO.map((row) => row.id)).toEqual([b.result.id]);
    for (const record of [b, promo, ad]) await mutateBanner(admin, { action: "activation", requestId: randomUUID(), id: record.result.id, version: 1, isActive: false }); expect(await getHomepageBanners()).toEqual({ HERO: [], PROMO: [], AD: [] });
  });
  it("keeps shared banner/catalog images through cleanup and queues replacement/deletion without deleting live bytes", async () => {
    const saved = await create(), original = saved.row!.imageUrl, key = new URL(original).pathname.slice(1), replacement = await upload();
    const brand = await mockDatabase.brand.create({ data: { name: randomUUID(), slug: randomUUID(), logo: original } });
    await mutateBanner(admin, { action: "image", id: saved.result.id, version: 1, requestId: randomUUID(), uploadKey: replacement.fileKey });
    fixture.objects.get(`/fixture-media/${key}`)!.modified = new Date(0); await mockDatabase.productImageCleanup.update({ where: { key }, data: { availableAt: new Date(0) } });
    expect((await processImageCleanupJobs(mockDatabase, store, { apply: true })).retained).toBeGreaterThan(0); expect(fixture.objects.has(`/fixture-media/${key}`)).toBe(true);
    // A currently live banner is protected even when a cleanup job already exists.
    await mockDatabase.productImageCleanup.create({ data: { key: replacement.fileKey, ownerId: admin.id, availableAt: new Date(0) } }); fixture.objects.get(`/fixture-media/${replacement.fileKey}`)!.modified = new Date(0);
    expect((await processImageCleanupJobs(mockDatabase, store, { apply: true })).retained).toBeGreaterThan(0);
    await mutateBanner(admin, { action: "delete", id: saved.result.id, version: 2, requestId: randomUUID() }); await mockDatabase.productImageCleanup.update({ where: { key: replacement.fileKey }, data: { availableAt: new Date(0) } }); expect((await processImageCleanupJobs(mockDatabase, store, { apply: true })).removed).toBeGreaterThan(0);
    expect((await mockDatabase.brand.findUniqueOrThrow({ where: { id: brand.id } })).logo).toBe(original);
  });
  it("rejects foreign/malformed/changed objects and revoked authority before publication", async () => {
    const foreign = await upload(second); await expect(mutateBanner(admin, { action: "create", requestId: randomUUID(), fields: fields(), uploadKey: foreign.fileKey })).rejects.toMatchObject({ code: "BANNER_IMAGE_OWNER" });
    const invalid = await upload(admin, Buffer.from("invalid png")); await expect(mutateBanner(admin, { action: "create", requestId: randomUUID(), fields: fields(), uploadKey: invalid.fileKey })).rejects.toThrow("complete");
    const file = await upload(second), verify = store.verify.bind(store), spy = jest.spyOn(store, "verify").mockImplementationOnce(async (...args) => { const result = await verify(...args); await mockDatabase.user.update({ where: { id: second.id }, data: { sessionVersion: { increment: 1 } } }); return result; });
    try { await expect(mutateBanner(second, { action: "create", requestId: randomUUID(), fields: fields(), uploadKey: file.fileKey })).rejects.toMatchObject({ code: "BANNER_ACCOUNT_CHANGED" }); } finally { spy.mockRestore(); }
    const changed = await upload(), originalAssert = store.assertPresent.bind(store), changedSpy = jest.spyOn(store, "assertPresent").mockImplementationOnce(async (...args) => { fixture.objects.get(`/fixture-media/${changed.fileKey}`)!.etag = '"changed"'; return originalAssert(...args); });
    try { await expect(mutateBanner(admin, { action: "create", requestId: randomUUID(), fields: fields(), uploadKey: changed.fileKey })).rejects.toThrow(); } finally { changedSpy.mockRestore(); }
  });
  it("bounds active placement capacity, paginates literal searches and rejects unsafe legacy display", async () => {
    const prefix = `PAGE_${randomUUID()}`;
    for (let n = 0; n < 25; n++) await create({ title: `${prefix}_${n}`, placement: "PROMO", isActive: n < 24 });
    const first = await readBanners(admin, { q: prefix, placement: "PROMO" }), last = await readBanners(admin, { q: prefix, placement: "PROMO", page: 2 }); expect(first.rows).toHaveLength(20); expect(last.rows).toHaveLength(5);
    await expect(create({ placement: "PROMO", isActive: true })).rejects.toMatchObject({ code: "BANNER_CAPACITY" });
    expect((await readBanners(admin, { q: "%" })).rows).toHaveLength(0); expect((await readBanners(admin, { q: prefix, status: "INACTIVE" })).total).toBe(1);
    const bad = await mockDatabase.banner.create({ data: { title: "Unsafe imported banner", imageUrl: "https://cdn.example.invalid/image.png", linkUrl: "javascript:alert(1)", placement: "AD" } });
    await expect(getHomepageBanners()).rejects.toThrow("review"); await mockDatabase.banner.delete({ where: { id: bad.id } });
    const inactive = await mockDatabase.banner.create({ data: { title: "Inactive imported banner", imageUrl: "javascript:alert(1)", isActive: false } });
    await expect(mutateBanner(admin, { action: "activation", id: inactive.id, version: 1, isActive: true, requestId: randomUUID() })).rejects.toMatchObject({ code: "BANNER_PUBLICATION" });
  });
  it("protects strict private routes, body bounds, owner, current role/session and request limits", async () => {
    const api = await import("@/app/api/admin/banners/route"), request = (query = "", body?: unknown, owner = admin.id) => new Request(`http://localhost/api/admin/banners${query}`, { method: body ? "POST" : "GET", headers: { "X-Banner-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(403); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    expect((await api.GET(request("", undefined, second.id))).status).toBe(409); expect((await api.GET(request("?page=1&page=2"))).status).toBe(400); expect((await api.POST(request("", { padding: "x".repeat(17000) }))).status).toBe(413);
    expect((await api.GET(request())).headers.get("cache-control")).toBe("private, no-store"); (rateLimit as jest.Mock).mockResolvedValueOnce({ success: false }); expect((await api.GET(request())).status).toBe(429);
    await expect(readBanners(seller, {})).rejects.toMatchObject({ status: 403 }); await expect(readBanners(second, {})).rejects.toMatchObject({ code: "BANNER_ACCOUNT_CHANGED" });
  });
});
