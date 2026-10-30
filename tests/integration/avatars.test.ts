import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient, User } from "@prisma/client";
import { startS3MediaFixture } from "@/tests/helpers/s3-media-fixture";
import { createAvatarMediaStore } from "@/lib/cloudflare/avatar-store";
import { normalizeAvatarImage, type NormalizedAvatar } from "@/lib/avatar-image";
import { publishOwnedAvatar, readOwnedAvatar, removeOwnedAvatar, restoreLegacyAvatar } from "@/lib/avatars";
import { cleanupAvatarOrphans, processAvatarCleanupJobs } from "@/lib/avatar-cleanup";
import { AVATAR_DETACH_RETENTION_MS } from "@/lib/avatar-policy";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("owned avatar storage and cleanup with actual PostgreSQL/S3 HTTP/Sharp", () => {
  let db: PrismaClient, owner: User, other: User, fixture: Awaited<ReturnType<typeof startS3MediaFixture>>, store: ReturnType<typeof createAvatarMediaStore>, client: S3Client, image: NormalizedAvatar;
  const prefix = `audit-avatar-${randomUUID()}`;
  const age = async () => { for (const value of fixture.objects.values()) value.modified = new Date(Date.now() - AVATAR_DETACH_RETENTION_MS - 60_000); await db.avatarImageCleanup.updateMany({ where: { ownerId: { in: [owner.id, other.id] } }, data: { availableAt: new Date(0) } }); };
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    owner = await db.user.create({ data: { email: `${prefix}@example.invalid`, isVerified: true } }); other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, isVerified: true } });
    fixture = await startS3MediaFixture(); client = new S3Client({ endpoint: fixture.endpoint, forcePathStyle: true, region: "auto", credentials: fixture.credentials, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
    store = createAvatarMediaStore(client, "fixture-media", "https://cdn.media.example.invalid");
    image = await normalizeAvatarImage(await sharp({ create: { width: 100, height: 80, channels: 3, background: "blue" } }).png().toBuffer(), "image/png");
  });
  beforeEach(async () => {
    fixture.setAvailable(true); fixture.objects.clear();
    await db.avatarImageCleanup.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } }); await db.userAvatarLegacy.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
    await db.user.updateMany({ where: { id: { in: [owner.id, other.id] } }, data: { avatar: null, avatarKey: null, avatarVersion: 0 } }); owner = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
  });
  afterAll(async () => { try {
    if (db && owner && other) { await db.avatarImageCleanup.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } }); await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } }); }
  } finally { client?.destroy(); await fixture?.close(); await db?.$disconnect(); } });
  it("publishes only the stored normalized object and replaces it with a durable delayed cleanup job", async () => {
    const first = await publishOwnedAvatar(owner, 0, image, store); expect(first).toMatchObject({ ownerId: owner.id, avatarVersion: 1, legacyAvatarAvailable: false }); expect(first.avatar).toMatch(/^https:\/\/cdn\.media\.example\.invalid\/avatars\//);
    const original = await db.user.findUniqueOrThrow({ where: { id: owner.id } }); expect(original.avatarKey).toBeTruthy(); expect((await sharp(fixture.objects.get(`/fixture-media/${original.avatarKey}`)!.body).metadata()).format).toBe("webp"); expect(await db.avatarImageCleanup.count({ where: { ownerId: owner.id } })).toBe(0);
    const second = await publishOwnedAvatar(owner, 1, image, store); expect(second.avatarVersion).toBe(2); expect(second.avatar).not.toBe(first.avatar);
    const job = await db.avatarImageCleanup.findUniqueOrThrow({ where: { key: original.avatarKey! } }); expect(job.availableAt.getTime()).toBeGreaterThan(Date.now() + AVATAR_DETACH_RETENTION_MS - 5000);
    expect((await processAvatarCleanupJobs(db, store, { apply: true })).inspected).toBe(0); expect(fixture.objects.size).toBe(2);
    await age(); expect(await processAvatarCleanupJobs(db, store, { apply: false })).toMatchObject({ removed: 0, errors: 0 }); expect(fixture.objects.size).toBe(2);
    expect(await processAvatarCleanupJobs(db, store, { apply: true })).toMatchObject({ removed: 1, errors: 0 }); expect(fixture.objects.size).toBe(1); expect((await readOwnedAvatar(owner)).avatar).toBe(second.avatar);
  });
  it("leaves the account unchanged and a durable retry job when provider PUT fails", async () => {
    fixture.setAvailable(false); await expect(publishOwnedAvatar(owner, 0, image, store)).rejects.toThrow();
    expect(await readOwnedAvatar(owner)).toMatchObject({ avatar: null, avatarVersion: 0 }); expect(await db.avatarImageCleanup.count({ where: { ownerId: owner.id } })).toBe(1);
    fixture.setAvailable(true); await age(); expect(await processAvatarCleanupJobs(db, store, { apply: true })).toMatchObject({ missing: 1, errors: 0 });
  });
  it("rechecks session authority after actual object upload and keeps the orphan available for cleanup", async () => {
    const put = store.put.bind(store); let uploaded!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => { uploaded = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = jest.spyOn(store, "put").mockImplementationOnce(async (...args) => { const result = await put(...args); uploaded(); await gate; return result; });
    const pending = publishOwnedAvatar(owner, 0, image, store), rejected = expect(pending).rejects.toMatchObject({ code: "AVATAR_ACCOUNT_CHANGED" });
    try { await ready; await db.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } }); release(); await rejected; expect(fixture.objects.size).toBe(1); expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).avatar).toBeNull(); await age(); expect((await processAvatarCleanupJobs(db, store, { apply: true })).removed).toBe(1); }
    finally { release(); await rejected; spy.mockRestore(); }
  });
  it("serializes competing replacements with a visible revision conflict and cleans the losing upload", async () => {
    const results = await Promise.allSettled([publishOwnedAvatar(owner, 0, image, store), publishOwnedAvatar(owner, 0, image, store)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const current = await db.user.findUniqueOrThrow({ where: { id: owner.id } }); expect(current.avatarVersion).toBe(1); await age(); await cleanupAvatarOrphans(db, store, { apply: true }); expect(fixture.objects.has(`/fixture-media/${current.avatarKey}`)).toBe(true); expect(fixture.objects.size).toBe(1);
  });
  it("retains active objects across CDN aliases and respects new pending-job grace during an orphan scan", async () => {
    const saved = await publishOwnedAvatar(owner, 0, image, store), current = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    await db.user.update({ where: { id: owner.id }, data: { avatar: saved.avatar!.replace("cdn.media.example.invalid", "previous.cdn.example.invalid") } }); await age();
    expect(await cleanupAvatarOrphans(db, store, { apply: true })).toMatchObject({ retained: 1, removed: 0 });
    await publishOwnedAvatar(owner, 1, image, store); for (const value of fixture.objects.values()) value.modified = new Date(0);
    const scanned = await cleanupAvatarOrphans(db, store, { apply: true }); expect(scanned.removed).toBe(0); expect(fixture.objects.has(`/fixture-media/${current.avatarKey}`)).toBe(true);
  });
  it("restores supported legacy raster data through the real pipeline and never fetches a remote legacy URL", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "green" } }).png().toBuffer();
    await db.userAvatarLegacy.create({ data: { userId: owner.id, value: `data:image/png;base64,${png.toString("base64")}` } }); expect((await readOwnedAvatar(owner)).legacyAvatarAvailable).toBe(true);
    expect(await restoreLegacyAvatar(owner, 0, store)).toMatchObject({ avatarVersion: 1, legacyAvatarAvailable: false });
    await db.userAvatarLegacy.create({ data: { userId: owner.id, value: "https://private.example.invalid/photo.svg?secret=retained" } });
    const before = fixture.objects.size; await expect(restoreLegacyAvatar(owner, 1, store)).rejects.toMatchObject({ code: "AVATAR_TYPE" }); expect(fixture.objects.size).toBe(before); expect((await readOwnedAvatar(owner)).legacyAvatarAvailable).toBe(true);
  });
  it("removes the active reference and older private backup atomically while retaining a delayed object job", async () => {
    await publishOwnedAvatar(owner, 0, image, store); await db.userAvatarLegacy.create({ data: { userId: owner.id, value: "unverified old photo" } });
    await expect(removeOwnedAvatar(owner, 0)).rejects.toMatchObject({ code: "AVATAR_CHANGED" }); expect((await readOwnedAvatar(owner)).legacyAvatarAvailable).toBe(true);
    expect(await removeOwnedAvatar(owner, 1)).toEqual({ ownerId: owner.id, avatar: null, avatarVersion: 2, legacyAvatarAvailable: false }); expect(await db.avatarImageCleanup.count({ where: { ownerId: owner.id } })).toBe(1); expect(fixture.objects.size).toBe(1);
    expect((await removeOwnedAvatar(owner, 2)).avatarVersion).toBe(2);
  });
  it("keeps uploaded objects discoverable for cleanup when a final SQL publication fails", async () => {
    const constraint = `audit_avatar_failure_${randomUUID().replaceAll("-", "")}`;
    if (!/^audit_avatar_failure_[a-f0-9]{32}$/.test(constraint) || !/^[a-f0-9-]{36}$/.test(owner.id)) throw new Error("Invalid SQL fixture identifiers");
    await db.$executeRawUnsafe(`ALTER TABLE "User" ADD CONSTRAINT "${constraint}" CHECK (id<>'${owner.id}' OR avatar IS NULL)`);
    try { await expect(publishOwnedAvatar(owner, 0, image, store)).rejects.toThrow(); expect((await readOwnedAvatar(owner)).avatar).toBeNull(); expect(await db.avatarImageCleanup.count({ where: { ownerId: owner.id } })).toBe(1); expect(fixture.objects.size).toBe(1); }
    finally { await db.$executeRawUnsafe(`ALTER TABLE "User" DROP CONSTRAINT "${constraint}"`); }
    await age(); expect((await processAvatarCleanupJobs(db, store, { apply: true })).removed).toBe(1);
  });
  it("serializes concurrent cleanup workers and retries a completed provider delete after transaction failure", async () => {
    await publishOwnedAvatar(owner, 0, image, store); const row = await db.user.findUniqueOrThrow({ where: { id: owner.id } }); await removeOwnedAvatar(owner, 1); await age();
    const remove = store.removeUnused.bind(store), spy = jest.spyOn(store, "removeUnused").mockImplementationOnce(async (key) => { await remove(key); throw new Error("Test-only failure after actual provider deletion"); });
    try {
      expect(await processAvatarCleanupJobs(db, store, { apply: true })).toMatchObject({ errors: 1, removed: 0 }); expect(fixture.objects.size).toBe(0);
      expect(await db.avatarImageCleanup.findUnique({ where: { key: row.avatarKey! } })).toMatchObject({ attempts: 1 });
      await age(); expect(await processAvatarCleanupJobs(db, store, { apply: true })).toMatchObject({ missing: 1, errors: 0 });
    } finally { spy.mockRestore(); }
    await publishOwnedAvatar(owner, 2, image, store); await removeOwnedAvatar(owner, 3); await age(); const count = jest.spyOn(store, "removeUnused");
    try { const results = await Promise.all([processAvatarCleanupJobs(db, store, { apply: true }), processAvatarCleanupJobs(db, store, { apply: true })]); expect(results.reduce((sum, result) => sum + result.removed, 0)).toBe(1); expect(count).toHaveBeenCalledTimes(1); expect(results.every((r) => !r.errors)).toBe(true); }
    finally { count.mockRestore(); }
  });
  it("retains a detached avatar still referenced by a product gallery on an older CDN domain", async () => {
    const saved = await publishOwnedAvatar(owner, 0, image, store), category = await db.category.create({ data: { name: prefix, slug: `${prefix}-${randomUUID()}` } });
    let product: { id: string } | undefined;
    try {
      product = await db.product.create({ data: { name: "Retained imported photo", slug: `${prefix}-${randomUUID()}`, sellerId: other.id, categoryId: category.id, price: 10, stock: 1, images: [saved.avatar!.replace("cdn.media", "historical.media")] } });
      await removeOwnedAvatar(owner, 1); await age(); expect(await processAvatarCleanupJobs(db, store, { apply: true })).toMatchObject({ retained: 1, removed: 0 }); expect(await cleanupAvatarOrphans(db, store, { apply: true })).toMatchObject({ retained: 1, removed: 0 });
      await db.product.delete({ where: { id: product.id } }); product = undefined; expect((await cleanupAvatarOrphans(db, store, { apply: true })).removed).toBe(1);
    } finally { if (product) await db.product.delete({ where: { id: product.id } }); await db.category.delete({ where: { id: category.id } }); }
  });
  it("scans a bounded storage page and exposes the actual SDK continuation token", async () => {
    for (let i = 0; i < 102; i++) fixture.objects.set(`/fixture-media/avatars/${owner.id}/${randomUUID()}.webp`, { body: image.bytes, type: "image/webp", etag: '"fixture"', modified: new Date(0) });
    const first = await cleanupAvatarOrphans(db, store); expect(first).toMatchObject({ inspected: 100, unused: 100, removed: 0, errors: 0 }); expect(first.cursor).toBeTruthy();
    const second = await cleanupAvatarOrphans(db, store, { cursor: first.cursor }); expect(second).toMatchObject({ inspected: 2, unused: 2, removed: 0, errors: 0 }); expect(second.cursor).toBeUndefined(); expect(fixture.objects.size).toBe(102);
  });
  it("serializes final publication with cleanup under the actual owner lock whichever operation wins", async () => {
    const deferred = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
    const waitForLock = async () => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM "User"%'`;
        if (Number(row.total)) return; await delay(10);
      }
      throw new Error("Expected a real competing owner-row lock");
    };
    for (const publishWins of [true, false]) {
      const entered = deferred(), decisive = deferred(), uploaded = deferred(), putGate = deferred();
      const originalPut = store.put.bind(store), originalHead = store.assertPresent.bind(store), originalRemove = store.removeUnused.bind(store);
      let key = "";
      const put = jest.spyOn(store, "put").mockImplementationOnce(async (...args) => {
        const result = await originalPut(...args); key = result.key; fixture.objects.get(`/fixture-media/${key}`)!.modified = new Date(0); await db.avatarImageCleanup.update({ where: { key }, data: { availableAt: new Date(0) } }); uploaded.release(); if (!publishWins) await putGate.promise; return result;
      });
      const head = publishWins ? jest.spyOn(store, "assertPresent").mockImplementationOnce(async (...args) => { const result = await originalHead(...args); entered.release(); await decisive.promise; return result; }) : undefined;
      const remove = !publishWins ? jest.spyOn(store, "removeUnused").mockImplementationOnce(async (value) => { entered.release(); await decisive.promise; await originalRemove(value); }) : undefined;
      const before = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
      const publication = publishOwnedAvatar(owner, before.avatarVersion, image, store).then((value) => ({ saved: true as const, value }), () => ({ saved: false as const }));
      let cleanup: ReturnType<typeof processAvatarCleanupJobs> | undefined;
      try {
        await uploaded.promise;
        if (publishWins) { await entered.promise; cleanup = processAvatarCleanupJobs(db, store, { apply: true }); }
        else { cleanup = processAvatarCleanupJobs(db, store, { apply: true }); await entered.promise; putGate.release(); }
        await waitForLock(); decisive.release();
        expect((await publication).saved).toBe(publishWins); expect((await cleanup).errors).toBe(0); expect(fixture.objects.has(`/fixture-media/${key}`)).toBe(publishWins);
        const after = await db.user.findUniqueOrThrow({ where: { id: owner.id } }); expect(after.avatarVersion).toBe(before.avatarVersion + (publishWins ? 1 : 0)); if (!publishWins) expect(after.avatar).toBe(before.avatar);
      } finally { putGate.release(); decisive.release(); await publication; await cleanup; put.mockRestore(); head?.mockRestore(); remove?.mockRestore(); }
    }
  });
});
