jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: () => ({ value: "avatar-api-fixture" }) }) }));
jest.mock("@/lib/session-validation", () => ({ validateSessionToken: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("@/lib/cloudflare/avatar-store", () => ({ ...jest.requireActual("@/lib/cloudflare/avatar-store"), avatarMediaStore: jest.fn() }));
jest.mock("@/lib/mail/send-otp", () => ({ sendOtpEmail: jest.fn() }));
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient, User } from "@prisma/client";
import { validateSessionToken } from "@/lib/session-validation";
import { rateLimit } from "@/lib/rate-limit";
import { avatarMediaStore, createAvatarMediaStore } from "@/lib/cloudflare/avatar-store";
import { startS3MediaFixture } from "@/tests/helpers/s3-media-fixture";
import { GET, POST, DELETE } from "@/app/api/user/upload-avatar/route";
import { GET as getProfile, PUT as putProfile } from "@/app/api/user/profile/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { sendOtpEmail } from "@/lib/mail/send-otp";
import { POST as cleanup } from "@/app/api/internal/avatars/cleanup/route";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("avatar HTTP handlers with real SQL, Sharp and signed S3 SDK requests", () => {
  let db: PrismaClient, user: User, client: S3Client, fixture: Awaited<ReturnType<typeof startS3MediaFixture>>, png: Buffer;
  const prefix = `audit-avatar-api-${randomUUID()}`;
  const request = (method: string, data?: unknown, owner = user.id) => new Request("http://localhost/api/user/upload-avatar", { method, headers: { "Content-Type": "application/json", "X-Avatar-Owner": owner, "X-Profile-Owner": owner }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const upload = (version = 0) => POST(request("POST", { avatarVersion: version, avatar: `data:image/png;base64,${png.toString("base64")}` }));
  const saved = () => db.user.findUniqueOrThrow({ where: { id: user.id } });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    user = await db.user.create({ data: { email: `${prefix}@example.invalid`, name: "API photo owner", isVerified: true } });
    fixture = await startS3MediaFixture(); client = new S3Client({ endpoint: fixture.endpoint, forcePathStyle: true, region: "auto", credentials: fixture.credentials, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED" });
    (avatarMediaStore as jest.Mock).mockReturnValue(createAvatarMediaStore(client, "fixture-media", "https://cdn.media.example.invalid"));
    png = await sharp({ create: { width: 40, height: 30, channels: 4, background: "red" } }).png().toBuffer();
  });
  beforeEach(async () => {
    fixture.setAvailable(true); fixture.objects.clear();
    await db.avatarImageCleanup.deleteMany({ where: { ownerId: user.id } }); await db.userAvatarLegacy.deleteMany({ where: { userId: user.id } }); await db.address.deleteMany({ where: { userId: user.id } });
    user = await db.user.update({ where: { id: user.id }, data: { avatar: null, avatarKey: null, avatarVersion: 0, name: "API photo owner" } });
    (validateSessionToken as jest.Mock).mockResolvedValue(user); (rateLimit as jest.Mock).mockReset().mockResolvedValue({ success: true });
  });
  afterAll(async () => { try { if (db && user) { await db.avatarImageCleanup.deleteMany({ where: { ownerId: user.id } }); await db.user.delete({ where: { id: user.id } }); } } finally { client?.destroy(); await fixture?.close(); await db?.$disconnect(); } });
  it("publishes normalized JSON and multipart files with revisions, private metadata and no raw storage keys", async () => {
    const first = await upload(); expect(first.status).toBe(200); expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    const data = await first.json(); expect(data.photo).toMatchObject({ ownerId: user.id, avatarVersion: 1, legacyAvatarAvailable: false }); expect(data.photo.avatar).toContain(`/avatars/${user.id}/`); expect(data.photo.avatarKey).toBeUndefined();
    const form = new FormData(); form.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "untrusted-name.exe"); form.set("avatarVersion", "1");
    const next = await POST(new Request("http://localhost/api/user/upload-avatar", { method: "POST", headers: { "X-Avatar-Owner": user.id }, body: form }));
    expect(next.status).toBe(200); const photo = (await next.json()).photo; expect(photo.avatarVersion).toBe(2); expect(photo.avatar).not.toBe(data.photo.avatar);
    const row = await saved(), object = fixture.objects.get(`/fixture-media/${row.avatarKey}`)!; expect((await sharp(object.body).metadata()).format).toBe("webp"); expect(await db.avatarImageCleanup.count({ where: { ownerId: user.id } })).toBe(1);
  });
  it("does not read an unauthenticated or mismatched-owner image body", async () => {
    const req = request("POST", { avatar: "ignored" }, "another-account"), read = jest.spyOn(req.body!, "getReader");
    expect((await POST(req)).status).toBe(409); expect(read).not.toHaveBeenCalled();
    (validateSessionToken as jest.Mock).mockResolvedValue(null); const absent = request("POST", {}), absentRead = jest.spyOn(absent.body!, "getReader");
    expect((await POST(absent)).status).toBe(401); expect(absentRead).not.toHaveBeenCalled(); expect(fixture.objects.size).toBe(0);
  });
  it("rejects invalid/oversized images, unsupported fields and revision-free mutations before storage", async () => {
    for (const body of [{ avatarVersion: 0, avatar: "https://remote.invalid/photo.png" }, { avatarVersion: 0, avatar: `data:image/jpeg;base64,${png.toString("base64")}` }, { avatarVersion: 0, avatar: "data:image/png;base64,aW52YWxpZA==" }, { avatar: `data:image/png;base64,${png.toString("base64")}` }, { avatarVersion: 0, action: "restore-legacy", userId: "other" }]) expect((await POST(request("POST", body))).status).toBe(400);
    const tooLarge = request("POST", {}); tooLarge.headers.set("Content-Length", "8000000"); expect((await POST(tooLarge)).status).toBe(413);
    expect((await DELETE(request("DELETE", {}))).status).toBe(400); expect(fixture.objects.size).toBe(0); expect((await saved()).avatarVersion).toBe(0);
  });
  it("preserves the current photo on stale revisions, provider failure and a revoked session", async () => {
    expect((await upload()).status).toBe(200); const first = await saved();
    expect((await upload(0)).status).toBe(409); expect((await DELETE(request("DELETE", { avatarVersion: 0 }))).status).toBe(409);
    fixture.setAvailable(false); const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try { expect((await upload(1)).status).toBe(503); } finally { log.mockRestore(); fixture.setAvailable(true); }
    expect((await saved()).avatar).toBe(first.avatar);
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } }); expect((await upload(1)).status).toBe(409); expect((await saved()).avatar).toBe(first.avatar);
  });
  it("closes profile and registration avatar bypasses, while allowing a revision-bound atomic profile clear", async () => {
    await upload(); const first = await saved();
    for (const avatar of ["https://remote.invalid/photo.png", `data:image/png;base64,${png.toString("base64")}`, first.avatar!.replace(user.id, "other-owner")]) expect((await putProfile(request("PUT", { name: "Should not persist", avatar, avatarVersion: 1 }))).status).toBe(400);
    expect((await putProfile(request("PUT", { name: "Should not persist", avatar: "", avatarVersion: 0 }))).status).toBe(409); expect((await saved()).name).toBe("API photo owner");
    expect((await putProfile(request("PUT", { avatar: first.avatar, avatarVersion: 1 }))).status).toBe(200);
    expect((await register(request("POST", { name: "Another person", email: `${prefix}-rejected@example.invalid`, password: "Valid password!123", avatar: first.avatar }))).status).toBe(400); expect(sendOtpEmail).not.toHaveBeenCalled();
    const cleared = await putProfile(request("PUT", { name: "Photo cleared", avatar: null, avatarVersion: 1 })); expect(cleared.status).toBe(200); expect((await cleared.json()).user).toMatchObject({ name: "Photo cleared", avatar: null, avatarVersion: 2 }); expect(await db.avatarImageCleanup.count({ where: { ownerId: user.id } })).toBe(1);
  });
  it("rolls back photo removal, legacy consumption and queued cleanup if the combined address save fails", async () => {
    await upload(); await db.userAvatarLegacy.create({ data: { userId: user.id, value: "private historical source" } }); const first = await saved();
    const address = { fullName: "Home", phone: "01700000000", street: "Street", city: "Dhaka", district: "Dhaka" };
    await db.address.create({ data: { ...address, userId: user.id, isDefault: true } });
    const response = await putProfile(request("PUT", { name: "Must roll back", avatar: "", avatarVersion: 1, address, addressRevision: null }));
    expect(response.status).toBe(409); const after = await saved(); expect(after.avatar).toBe(first.avatar); expect(after.name).toBe(first.name); expect(after.avatarVersion).toBe(1); expect(await db.userAvatarLegacy.count({ where: { userId: user.id } })).toBe(1); expect(await db.avatarImageCleanup.count({ where: { ownerId: user.id } })).toBe(0);
  });
  it("keeps legacy values private across avatar metadata, auth and profile reads; restore consumes only validated raster data", async () => {
    const source = `data:image/png;base64,${png.toString("base64")}`;
    await db.userAvatarLegacy.create({ data: { userId: user.id, value: source } });
    for (const response of [await GET(request("GET")), await getProfile(request("GET")), await me()]) { const text = JSON.stringify(await response.json()); expect(text).not.toContain(source); expect(text).not.toContain("avatarKey"); expect(text).not.toContain("legacyAvatar\""); }
    const restored = await POST(request("POST", { action: "restore-legacy", avatarVersion: 0 })); expect(restored.status).toBe(200); expect((await restored.json()).photo).toMatchObject({ avatarVersion: 1, legacyAvatarAvailable: false });
    expect((await DELETE(request("DELETE", { avatarVersion: 1 }))).status).toBe(200); expect((await saved()).avatar).toBeNull();
  });
  it.each(["ip", "account"])("enforces the %s budget before reading or uploading any image", async (kind) => {
    (rateLimit as jest.Mock).mockReset().mockResolvedValue({ success: false }); if (kind === "account") (rateLimit as jest.Mock).mockResolvedValueOnce({ success: true });
    const req = request("POST", {}), read = jest.spyOn(req.body!, "getReader"); const response = await POST(req); expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60"); expect(read).not.toHaveBeenCalled(); expect(fixture.objects.size).toBe(0);
  });
  it("requires maintenance authentication and the exact explicit database target for cleanup", async () => {
    const old = process.env.MEDIA_CLEANUP_DATABASE, oldSecret = process.env.CHECKOUT_SWEEP_SECRET;
    try {
      process.env.CHECKOUT_SWEEP_SECRET = "isolated-avatar-maintenance-key-".repeat(2);
      process.env.MEDIA_CLEANUP_DATABASE = "audit_wrong_avatar_target";
      expect((await cleanup(request("POST"))).status).toBe(401);
      const req = request("POST"); req.headers.set("authorization", `Bearer ${process.env.CHECKOUT_SWEEP_SECRET}`); expect((await cleanup(req)).status).toBe(503);
      process.env.MEDIA_CLEANUP_DATABASE = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
      expect((await cleanup(req)).status).toBe(200);
    } finally { if (old === undefined) delete process.env.MEDIA_CLEANUP_DATABASE; else process.env.MEDIA_CLEANUP_DATABASE = old; if (oldSecret === undefined) delete process.env.CHECKOUT_SWEEP_SECRET; else process.env.CHECKOUT_SWEEP_SECRET = oldSecret; }
  });
});
