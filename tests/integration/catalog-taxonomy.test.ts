import type { PrismaClient, User } from "@prisma/client";
let mockDatabase: PrismaClient;
jest.mock("@/lib/prisma", () => ({ get prisma() { return mockDatabase; } }));
jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import { createFinanceDatabase } from "@/tests/helpers/finance-database";
import { startS3MediaFixture } from "@/tests/helpers/s3-media-fixture";
import * as storage from "@/lib/cloudflare/r2";
import { mutateTaxonomy, readTaxonomy } from "@/lib/catalog-taxonomy";
import { processImageCleanupJobs } from "@/lib/product-image-lifecycle";
import { cleanupProductImages } from "@/lib/product-media-cleanup";
import { getCurrentUserWithRole } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { TaxonomyMutation } from "@/lib/validations/taxonomy";
import { getCatalogListing } from "@/lib/catalog-listing";
import { resolveCatalogCategory } from "@/lib/catalog-category-filter";
import { resolveCatalogBrand } from "@/lib/catalog-brand-filter";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("catalog taxonomy with actual PostgreSQL and signed S3 HTTP", () => {
  let database: Awaited<ReturnType<typeof createFinanceDatabase>>, fixture: Awaited<ReturnType<typeof startS3MediaFixture>>, client: S3Client, store: ReturnType<typeof storage.createProductMediaStore>, image: Buffer;
  let admin: User, secondAdmin: User, seller: User;
  beforeAll(async () => {
    database = await createFinanceDatabase(); mockDatabase = database.db;
    fixture = await startS3MediaFixture(); client = new S3Client({ endpoint: fixture.endpoint, forcePathStyle: true, region: "auto", credentials: fixture.credentials, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
    store = storage.createProductMediaStore(client, "fixture-media", "https://cdn.media.example.invalid"); jest.spyOn(storage, "productMediaStore").mockReturnValue(store);
    image = await sharp({ create: { width: 50, height: 30, channels: 4, background: "red" } }).png().toBuffer();
    [admin, secondAdmin, seller] = await Promise.all(["ADMIN", "ADMIN", "MEMBER"].map((role) => mockDatabase.user.create({ data: { email: `${randomUUID()}@taxonomy.example.invalid`, role, isVerified: true, sellerStatus: "APPROVED" } })));
  }, 30_000);
  beforeEach(async () => { jest.clearAllMocks(); admin = await mockDatabase.user.findUniqueOrThrow({ where: { id: admin.id } }); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); });
  afterAll(async () => { jest.restoreAllMocks(); client?.destroy(); await fixture?.close(); await database?.close(); });
  const create = (kind: "category" | "brand" = "category", parentId: string | null = null, name = `Catalog ${randomUUID()}`) => mutateTaxonomy(admin, { action: "create", kind, requestId: randomUUID(), fields: { name, slug: `catalog-${randomUUID()}`, parentId } });
  const upload = async (owner = admin) => { const file = await store.prepare({ ownerId: owner.id, contentType: "image/png", size: image.length }); expect((await fetch(file.uploadUrl, { method: "PUT", headers: file.headers, body: new Uint8Array(image) })).status).toBe(200); return file; };
  const age = (key: string) => { fixture.objects.get(`/fixture-media/${key}`)!.modified = new Date(Date.now() - 48 * 3600_000); };
  const photo = (record: { id: string; version: number; kind: "category" | "brand" }, key: string | null, owner = admin) => mutateTaxonomy(owner, { action: "image", kind: record.kind, id: record.id, version: record.version, requestId: randomUUID(), uploadKey: key });
  it("deduplicates exact create/update/delete requests and records actual immutable administrator history", async () => {
    const input: TaxonomyMutation = { kind: "category", action: "create", requestId: randomUUID(), fields: { name: "Original root", slug: `original-${randomUUID()}`, parentId: null } };
    const result = await mutateTaxonomy(admin, input); expect(await mutateTaxonomy(admin, input)).toEqual(result);
    await expect(mutateTaxonomy(admin, { ...input, fields: { ...input.fields, name: "Different request content" } })).rejects.toMatchObject({ code: "TAXONOMY_REQUEST_CONFLICT" });
    const changed = await mutateTaxonomy(admin, { kind: "category", action: "update", requestId: randomUUID(), id: result.id, version: result.version, fields: { ...input.fields, name: "Renamed root", slug: `renamed-${randomUUID()}` } });
    expect(await mockDatabase.categoryAlias.findUnique({ where: { slug: input.fields.slug } })).toMatchObject({ categoryId: result.id });
    const deletion = { kind: "category", action: "delete", requestId: randomUUID(), id: result.id, version: changed.version };
    const deleted = await mutateTaxonomy(admin, deletion); expect(await mutateTaxonomy(admin, deletion)).toEqual(deleted); expect(await mockDatabase.category.findUnique({ where: { id: result.id } })).toBeNull();
    const history = await readTaxonomy(admin, { kind: "category", mode: "history", id: result.id }); expect(history.events).toHaveLength(3); expect(history.events.every((event) => event.actorId === admin.id)).toBe(true);
    await expect(mockDatabase.taxonomyEvent.deleteMany({ where: { targetId: result.id } })).rejects.toThrow();
  });
  it("enforces sibling names, prevents parent cycles and serializes competing observed revisions", async () => {
    const root = await create(), other = await create(), child = await create("category", root.id, "Accessories"); await create("category", other.id, "Accessories");
    await expect(create("category", root.id, " accessories ")).rejects.toMatchObject({ code: "P2002" });
    const rootSaved = await mockDatabase.category.findUniqueOrThrow({ where: { id: root.id } });
    await expect(mutateTaxonomy(admin, { action: "update", kind: "category", requestId: randomUUID(), id: root.id, version: root.version, fields: { name: rootSaved.name, slug: rootSaved.slug, parentId: child.id } })).rejects.toMatchObject({ code: "TAXONOMY_CYCLE" });
    const input = { action: "update", kind: "category", id: child.id, version: child.version, fields: { name: "Changed child", slug: `changed-${randomUUID()}`, parentId: root.id } };
    const results = await Promise.allSettled([mutateTaxonomy(admin, { ...input, requestId: randomUUID() }), mutateTaxonomy(secondAdmin, { ...input, requestId: randomUUID() })]); expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find((row) => row.status === "rejected")).toMatchObject({ reason: { code: "TAXONOMY_CHANGED" } });
    await expect(mutateTaxonomy(admin, { kind: "category", action: "delete", id: root.id, version: root.version, requestId: randomUUID() })).rejects.toMatchObject({ code: "TAXONOMY_IN_USE" });
  });
  it("protects every linked product including unpublished ones from category/brand deletion", async () => {
    const category = await create(), brand = await create("brand");
    const product = await mockDatabase.product.create({ data: { name: randomUUID(), slug: randomUUID(), price: 100, stock: 1, sellerId: seller.id, categoryId: category.id, brandId: brand.id } });
    for (const record of [category, brand]) await expect(mutateTaxonomy(admin, { kind: record.kind, id: record.id, version: record.version, action: "delete", requestId: randomUUID() })).rejects.toMatchObject({ code: "TAXONOMY_IN_USE" });
    expect((await mockDatabase.product.findUniqueOrThrow({ where: { id: product.id } })).brandId).toBe(brand.id);
  });
  it("publishes real verified images, retains shared category/brand references and cleans detached objects once", async () => {
    let category = await create(), brand = await create("brand"); const file = await upload();
    category = await photo(category, file.fileKey); brand = await photo(brand, file.fileKey); age(file.fileKey);
    expect((await cleanupProductImages(mockDatabase, store, { apply: true })).retained).toBeGreaterThan(0); expect(fixture.objects.has(`/fixture-media/${file.fileKey}`)).toBe(true);
    await photo(category, null); await mockDatabase.productImageCleanup.update({ where: { key: file.fileKey }, data: { availableAt: new Date(0) } });
    expect((await processImageCleanupJobs(mockDatabase, store, { apply: true })).retained).toBe(1); expect(fixture.objects.has(`/fixture-media/${file.fileKey}`)).toBe(true);
    brand = await photo(brand, null); await mockDatabase.productImageCleanup.update({ where: { key: file.fileKey }, data: { availableAt: new Date(0) } });
    expect((await processImageCleanupJobs(mockDatabase, store, { apply: true })).removed).toBe(1); expect(fixture.objects.has(`/fixture-media/${file.fileKey}`)).toBe(false);
    expect((await mockDatabase.brand.findUniqueOrThrow({ where: { id: brand.id } })).logo).toBeNull();
  });
  it("rechecks revoked authority after actual provider verification and leaves failed publication unreferenced", async () => {
    const category = await create(), file = await upload(), verify = store.verify.bind(store);
    const spy = jest.spyOn(store, "verify").mockImplementationOnce(async (...args) => { const result = await verify(...args); await mockDatabase.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } }); return result; });
    try { await expect(photo(category, file.fileKey)).rejects.toMatchObject({ code: "TAXONOMY_ACCOUNT_CHANGED" }); } finally { spy.mockRestore(); }
    expect((await mockDatabase.category.findUniqueOrThrow({ where: { id: category.id } })).image).toBeNull(); age(file.fileKey);
    expect((await cleanupProductImages(mockDatabase, store, { apply: true })).removed).toBeGreaterThan(0); expect(fixture.objects.has(`/fixture-media/${file.fileKey}`)).toBe(false);
  });
  it("paginates hierarchy paths, excludes self/descendant parents and treats search wildcards literally", async () => {
    const root = await create("category", null, "Unique search root"), child = await create("category", root.id, "Underscore_name");
    const selected = await readTaxonomy(admin, { kind: "category", q: "Underscore_" }); expect(selected.rows).toHaveLength(1); expect(selected.rows[0]).toMatchObject({ id: child.id, path: ["Unique search root", "Underscore_name"], parentId: root.id });
    const parents = await readTaxonomy(admin, { kind: "category", mode: "parents", id: root.id, q: "Unique search root" }); expect(parents.rows).toHaveLength(0);
    for (let index = 0; index < 22; index++) await create("brand", null, `Pageable brand ${index}`);
    const first = await readTaxonomy(admin, { kind: "brand", q: "Pageable brand", page: 1 }), second = await readTaxonomy(admin, { kind: "brand", q: "Pageable brand", page: 2 });
    expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(2); expect(first.total).toBe(22); expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(22);
  });
  it("enforces strict private handlers, observed owner, body bounds, current role and rate limits", async () => {
    const api = await import("@/app/api/admin/taxonomy/route"), request = (path = "/api/admin/taxonomy?kind=category", body?: unknown, owner = admin.id) => new Request(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { "X-Taxonomy-Owner": owner }, ...(body ? { body: JSON.stringify(body) } : {}) });
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await api.GET(request())).status).toBe(403); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    expect((await api.GET(request(undefined, undefined, seller.id))).status).toBe(409); expect((await api.GET(request("/api/admin/taxonomy?kind=category&kind=brand"))).status).toBe(400);
    expect((await api.POST(request("/api/admin/taxonomy", { action: "create", kind: "brand", requestId: randomUUID(), fields: { name: "Bad URL input", slug: "valid", logo: "https://unverified.example.invalid/logo.png" } }))).status).toBe(400);
    expect((await api.POST(request("/api/admin/taxonomy", { padding: "x".repeat(17000) }))).status).toBe(413);
    const good = await api.GET(request()); expect(good.status).toBe(200); expect(good.headers.get("cache-control")).toBe("private, no-store");
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); expect((await api.GET(request())).status).toBe(429);
  });
  it("includes descendants in parent storefront filters, intersects brands and resolves retained canonical URLs", async () => {
    const root = await create(), child = await create("category", root.id), unrelated = await create(), brand = await create("brand"), rootRow = await mockDatabase.category.findUniqueOrThrow({ where: { id: root.id } }), brandRow = await mockDatabase.brand.findUniqueOrThrow({ where: { id: brand.id } });
    const [visible, foreign] = await Promise.all([child, unrelated].map((category) => mockDatabase.product.create({ data: { name: randomUUID(), slug: randomUUID(), price: 100, stock: 3, sellerId: seller.id, categoryId: category.id, brandId: brand.id, status: "APPROVED" } })));
    await mockDatabase.product.create({ data: { name: randomUUID(), slug: randomUUID(), price: 100, stock: 3, sellerId: seller.id, categoryId: child.id, brandId: brand.id } });
    expect((await getCatalogListing({ categoryId: root.id, brandId: brand.id })).products.map((row) => row.id)).toEqual([visible.id]);
    expect((await getCatalogListing({ categoryId: unrelated.id, brandId: brand.id })).products.map((row) => row.id)).toEqual([foreign.id]);
    await mutateTaxonomy(admin, { action: "update", kind: "category", id: root.id, version: root.version, requestId: randomUUID(), fields: { name: rootRow.name, slug: `new-${randomUUID()}`, parentId: null } });
    await mutateTaxonomy(admin, { action: "update", kind: "brand", id: brand.id, version: brand.version, requestId: randomUUID(), fields: { name: brandRow.name, slug: `new-${randomUUID()}`, parentId: null } });
    expect(await resolveCatalogCategory(rootRow.slug, undefined)).toMatchObject({ state: "found", category: { id: root.id } }); expect(await resolveCatalogBrand(brandRow.slug, undefined)).toMatchObject({ state: "found", brand: { id: brand.id } });
    expect((await getCatalogListing({ category: rootRow.slug, brand: brandRow.slug })).products.map((row) => row.id)).toEqual([visible.id]);
  });
  it("rolls back image publication when the verified object changes and rejects a foreign owner's key", async () => {
    const category = await create(), file = await upload(), verify = store.verify.bind(store);
    const spy = jest.spyOn(store, "verify").mockImplementationOnce(async (...args) => { const result = await verify(...args); fixture.objects.get(`/fixture-media/${file.fileKey}`)!.etag = '"changed-object"'; return result; });
    try { await expect(photo(category, file.fileKey)).rejects.toThrow(); } finally { spy.mockRestore(); }
    expect((await mockDatabase.category.findUniqueOrThrow({ where: { id: category.id } })).image).toBeNull(); expect(await mockDatabase.taxonomyEvent.count({ where: { targetId: category.id } })).toBe(1);
    const foreign = await upload(secondAdmin); await expect(photo(category, foreign.fileKey)).rejects.toMatchObject({ code: "TAXONOMY_IMAGE_OWNER" });
  });
  it("recovers an original image publication receipt without re-verifying a detached object", async () => {
    const category = await create(), file = await upload(), body = { action: "image", kind: "category", id: category.id, version: category.version, requestId: randomUUID(), uploadKey: file.fileKey };
    const first = await mutateTaxonomy(admin, body); await photo(first, null); age(file.fileKey); await mockDatabase.productImageCleanup.update({ where: { key: file.fileKey }, data: { availableAt: new Date(0) } }); await processImageCleanupJobs(mockDatabase, store, { apply: true });
    expect(fixture.objects.has(`/fixture-media/${file.fileKey}`)).toBe(false); expect(await mutateTaxonomy(admin, body)).toEqual(first);
    expect((await readTaxonomy(admin, { kind: "brand", requestId: body.requestId })).attempt).toBeNull(); expect((await readTaxonomy(admin, { kind: "category", requestId: body.requestId })).attempt).toEqual(first);
  });
  it("runs the actual reference seed idempotently without undoing an operator's renamed taxonomy or creating accounts/products", async () => {
    const seed = () => new Promise<void>((done, reject) => { const child = spawn(process.execPath, [resolve("prisma/seeds/seed.js")], { env: { ...process.env, DATABASE_URL: database.url, DIRECT_URL: database.url }, stdio: "ignore" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error("Isolated reference seed failed"))); });
    const users = await mockDatabase.user.count(), products = await mockDatabase.product.count(); await seed();
    const category = await mockDatabase.category.findUniqueOrThrow({ where: { slug: "electronics" } }), brand = await mockDatabase.brand.findUniqueOrThrow({ where: { slug: "apple" } });
    await mutateTaxonomy(admin, { action: "update", kind: "category", id: category.id, version: category.version, requestId: randomUUID(), fields: { name: "Operator curated catalog", slug: "operator-curated-electronics", parentId: null } });
    await mutateTaxonomy(admin, { action: "update", kind: "brand", id: brand.id, version: brand.version, requestId: randomUUID(), fields: { name: "Operator curated brand", slug: "operator-curated-apple", parentId: null } });
    const categoryCount = await mockDatabase.category.count(), brandCount = await mockDatabase.brand.count(); await seed();
    expect(await mockDatabase.category.count()).toBe(categoryCount); expect(await mockDatabase.brand.count()).toBe(brandCount);
    expect((await mockDatabase.category.findUniqueOrThrow({ where: { id: category.id } })).name).toBe("Operator curated catalog"); expect((await mockDatabase.brand.findUniqueOrThrow({ where: { id: brand.id } })).slug).toBe("operator-curated-apple");
    expect(await mockDatabase.user.count()).toBe(users); expect(await mockDatabase.product.count()).toBe(products);
  }, 15_000);
});
