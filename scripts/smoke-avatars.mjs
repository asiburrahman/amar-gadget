import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "fixture setup";
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search || url.hash) throw new Error("Use an isolated local audit_* database.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }) });
  const ingress = randomBytes(32).toString("hex"), maintenance = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), prefix = `audit-avatar-smoke-${randomUUID()}`;
  let child, redis, provider, user, other;
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), { startS3MediaFixture } = await tsImport("../tests/helpers/s3-media-fixture.ts", import.meta.url);
    provider = await startS3MediaFixture(); const hashed = await hashPassword(password);
    user = await db.user.create({ data: { email: `${prefix}@example.invalid`, password: hashed, isVerified: true, name: "Avatar smoke owner" } }); other = await db.user.create({ data: { email: `${prefix}-other@example.invalid`, password: hashed, isVerified: true } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); phase = "prepared artifact startup";
    child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: ingress, CHECKOUT_SWEEP_SECRET: maintenance, R2_BUCKET_NAME: "fixture-media", R2_ACCESS_KEY_ID: provider.credentials.accessKeyId, R2_SECRET_ACCESS_KEY: provider.credentials.secretAccessKey, R2_PUBLIC_URL: "https://cdn.media.example.invalid", AUDIT_AVATAR_S3_FIXTURE: provider.endpoint, NODE_OPTIONS: `--require="${resolve("scripts/testing/avatar-s3-preload.cjs").replaceAll("\\", "/")}"` });
    await readFile(".next/standalone/scripts/avatar-cleanup-worker.mjs", "utf8");
    const signature = (method, target) => signIngress({ secret: ingress, origin: child.origin, ip: "127.0.0.1", method, target });
    const call = (method, path, cookie, body, extra = {}) => requestHttp(child.origin + path, { method, headers: { Cookie: cookie, Origin: child.origin, "Content-Type": "application/json", ...signature(method, path), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const login = async (account) => { const result = await call("POST", "/api/auth/login", "", { email: account.email, password }); assert.equal(result.status, 200); const cookie = result.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const cookie = await login(user), otherCookie = await login(other), path = "/api/user/upload-avatar", owner = { "X-Avatar-Owner": user.id };
    phase = "actual compiled JSON upload, normalization and CDN bytes";
    const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: "blue" } }).png().toBuffer(), body = { avatarVersion: 0, avatar: `data:image/png;base64,${png.toString("base64")}` };
    const first = await call("POST", path, cookie, body, owner); assert.equal(first.status, 200); const photo = (await first.json()).photo; assert.equal(photo.avatarVersion, 1); const row = await db.user.findUniqueOrThrow({ where: { id: user.id } }); assert.ok(row.avatarKey);
    const object = provider.objects.get(`/fixture-media/${row.avatarKey}`); assert.ok(object); assert.equal((await sharp(object.body).metadata()).format, "webp");
    const cdn = await requestHttp(provider.endpoint + new URL(photo.avatar).pathname, { headers: { Host: "cdn.media.example.invalid" } }); assert.equal(cdn.status, 200); assert.deepEqual(Buffer.from(await cdn.arrayBuffer()), object.body);
    phase = "actual multipart upload and durable previous-object cleanup";
    const form = new FormData(); form.set("file", new Blob([png], { type: "image/png" }), "photo.png"); form.set("avatarVersion", "1"); const encoded = new Request("http://localhost", { method: "POST", body: form });
    const multipart = await requestHttp(child.origin + path, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, ...owner, "Content-Type": encoded.headers.get("Content-Type"), ...signature("POST", path) }, body: Buffer.from(await encoded.arrayBuffer()) }); assert.equal(multipart.status, 200); assert.equal((await multipart.json()).photo.avatarVersion, 2); assert.equal(await db.avatarImageCleanup.count({ where: { ownerId: user.id } }), 1);
    phase = "private auth/profile DTOs, bypass and stale/foreign denial";
    const profile = await call("GET", "/api/user/profile", cookie); const profileText = await profile.text(); assert.ok(!profileText.includes("avatarKey") && !profileText.includes("data:image")); assert.ok(profileText.includes('"avatarVersion":2'));
    assert.equal((await call("POST", path, cookie, body, owner)).status, 409); assert.equal((await call("POST", path, otherCookie, { ...body, avatarVersion: 2 }, owner)).status, 409);
    assert.equal((await call("PUT", "/api/user/profile", cookie, { avatar: body.avatar, avatarVersion: 2 }, owner)).status, 400);
    const forged = await requestHttp(child.origin + path, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Content-Type": "application/json", ...owner }, body: JSON.stringify(body) }); assert.equal(forged.status, 403);
    const crossOrigin = await call("POST", path, cookie, body, { ...owner, Origin: "https://untrusted.example.invalid" }); assert.equal(crossOrigin.status, 403);
    phase = "profile HTML, revision-bound clear and dual-auth cleanup";
    assert.equal((await call("GET", "/user/profile", cookie)).status, 200);
    const removed = await call("DELETE", path, cookie, { avatarVersion: 2 }, owner); assert.equal(removed.status, 200); assert.equal((await removed.json()).photo.avatarVersion, 3);
    await db.avatarImageCleanup.updateMany({ where: { ownerId: user.id }, data: { availableAt: new Date(0) } }); for (const value of provider.objects.values()) value.modified = new Date(0);
    const cleanup = "/api/internal/avatars/cleanup";
    assert.equal((await requestHttp(child.origin + cleanup, { method: "POST", headers: signature("POST", cleanup) })).status, 401);
    const cleaned = await requestHttp(child.origin + cleanup, { method: "POST", headers: { authorization: `Bearer ${maintenance}`, ...signature("POST", cleanup) } }); assert.equal(cleaned.status, 200); const counts = await cleaned.json(); assert.equal(counts.removed, 2); assert.equal(provider.objects.size, 0);
    phase = "revoked copied cookie"; await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } }); assert.equal((await call("DELETE", path, cookie, { avatarVersion: 3 }, owner)).status, 401);
    return { preparedAvatarHandlers: "PASS", realSignedSDKAndSharpViaLocalTransport: "PASS", multipartAndJSON: "PASS", storedCDNBytes: "PASS", staleForeignOriginIngressRevocation: "PASS", privateDTOsAndProfileBypass: "PASS", durableCleanupAndDualAuth: "PASS", packagedAvatarWorker: "PASS" };
  } finally {
    await child?.stop(); await redis?.close(); await provider?.close();
    try { if (user) await db.avatarImageCleanup.deleteMany({ where: { ownerId: user.id } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error instanceof Error && /^(Standalone fixture|Use an exact local avatar fixture listener)/.test(error.message) ? error.message : "Private child/provider output was not published."; console.error(`Avatar smoke failed during ${phase}. ${detail}`); process.exitCode = 1; });
