import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { tsImport } from "tsx/esm/api";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { runtimeFixtureEnvironment } from "./testing/runtime-fixture.mjs";
import { signIngress } from "../lib/ingress-protocol.cjs";

class SmokeFailure extends Error {}

// Real local HTTP/SQL smoke, never a configured production database/provider.
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search) throw new SmokeFailure("Use a disposable local audit_* TEST_DATABASE_URL without query overrides.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }) });
  const prefix = `audit-http-${randomUUID()}`;
  const password = `Audit!${randomBytes(24).toString("hex")}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  let child, seller, category, product, redisFixture;
  let phase = "fixture setup";
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url);
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, password: await hashPassword(password), role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    redisFixture = await startRedisRestFixture(randomBytes(32).toString("hex"));
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    const galleryUrls = [`https://media.example.invalid/${prefix}-front.png`, `https://media.example.invalid/${prefix}-back.png`];
    product = await db.product.create({ data: { name: prefix, slug: prefix, price: 1234, stock: 2, status: "APPROVED", sellerId: seller.id, categoryId: category.id, imageUrl: galleryUrls[0], images: galleryUrls } });
    const probe = createServer();
    await new Promise((resolveListen, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolveListen); });
    const port = probe.address().port;
    await new Promise((resolveClose) => probe.close(resolveClose));
    let ready = false, output = "";
    phase = "server startup";
    const environment = runtimeFixtureEnvironment(url.toString(), `http://127.0.0.1:${port}`, redisFixture);
    child = spawn(process.execPath, [resolve(".next/standalone/start.cjs")], { stdio: ["ignore", "pipe", "pipe"], env: environment });
    child.on("error", () => controller.abort());
    child.stdout.on("data", (chunk) => { if (!ready) { output = (output + chunk.toString()).slice(-4096); ready = output.includes("Ready"); } });
    child.stderr.on("data", () => undefined); // Never publish captured environment/provider errors.
    const deadline = Date.now() + 30_000;
    while (!ready) {
      if (controller.signal.aborted || child.exitCode !== null || Date.now() > deadline) throw new SmokeFailure("Standalone server did not become ready.");
      await delay(100, undefined, { signal: controller.signal });
    }
    const origin = `http://127.0.0.1:${port}`;
    const assertion = (method, target) => signIngress({ secret: environment.TRUSTED_PROXY_SECRET, origin, ip: "127.0.0.1", method, target });
    const get = (path, cookie) => fetch(`${origin}${path}`, { redirect: "manual", headers: { ...assertion("GET", path), ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    phase = "health lookup";
    // First probes after a fresh Windows build have exceeded the old
    // arbitrary 10-second probe. Keep a distinct bounded startup budget and
    // report the actual duration; subsequent requests retain their 10s limit.
    const healthStarted = Date.now();
    const health = await fetch(`${origin}/api/health`, { redirect: "manual", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
    const firstHealthMs = Date.now() - healthStarted;
    if (health.status !== 200) throw new SmokeFailure("Health HTTP smoke failed.");
    phase = "catalog lookup";
    const catalog = await get(`/api/products?search=${encodeURIComponent(prefix)}`);
    const catalogData = await catalog.json();
    const products = catalogData.products ?? catalogData.data;
    if (catalog.status !== 200 || !Array.isArray(products) || !products.some((entry) => entry.id === product.id)) throw new SmokeFailure(`Real catalog HTTP/SQL smoke failed (status ${catalog.status}).`);
    phase = "product server render";
    const detail = await get(`/products/${prefix}`);
    const detailHtml = await detail.text();
    if (detail.status !== 200 || !detailHtml.includes(prefix)) throw new SmokeFailure(`Product page server-render smoke failed (status ${detail.status}).`);
    if (!galleryUrls.every((url) => detailHtml.includes(`src="${url}"`)) || !detailHtml.includes(`aria-label="View image 2 of ${prefix}"`)) throw new SmokeFailure("Saved custom-domain product gallery failed server rendering.");
    phase = "packaged public and static assets";
    const stylesheet = detailHtml.match(/href="([^\"]*\/_next\/static\/[^\"]+\.css[^\"]*)"/)?.[1];
    if (!stylesheet || !stylesheet.startsWith("/_next/static/") || (await get(stylesheet)).status !== 200 || (await get("/file.svg")).status !== 200) throw new SmokeFailure("Standalone public/static assets are missing.");
    phase = "admin redirect";
    const admin = await get("/admin/orders");
    if (![302, 303, 307, 308].includes(admin.status) || !admin.headers.get("location")?.includes("/login")) throw new SmokeFailure(`Unauthenticated admin redirect smoke failed (status ${admin.status}).`);
    phase = "signed session profile read";
    // Real built login/signing/password/SDK paths with an isolated account
    // and local REST provider fixture. No hosted provider is contacted.
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...assertion("POST", "/api/auth/login") }, body: JSON.stringify({ email: seller.email, password }), signal: AbortSignal.timeout(10_000) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (login.status !== 200 || !cookie || !(await login.json()).success) throw new SmokeFailure("Configured standalone login failed.");
    phase = "readiness";
    const readyResponse = await get("/api/health/ready");
    const readyBody = await readyResponse.json();
    if (readyResponse.status !== 200 || readyBody.status !== "READY") throw new SmokeFailure(`Configured readiness failed (HTTP ${readyResponse.status}, config=${readyBody.checks?.configuration === true}, db=${readyBody.checks?.database === true}, redis=${readyBody.checks?.redis === true}).`);
    const profile = await get("/api/user/profile", cookie);
    if (profile.status !== 200 || (await profile.json()).user?.id !== seller.id) throw new SmokeFailure("Signed profile HTTP read failed.");
    await db.user.update({ where: { id: seller.id }, data: { sessionVersion: { increment: 1 } } });
    phase = "copied-cookie revocation";
    if ((await get("/api/user/profile", cookie)).status !== 401) throw new SmokeFailure("Revoked cookie retained profile access.");
    const staleMe = await get("/api/auth/me", cookie);
    if ((await staleMe.json()).success !== false) throw new SmokeFailure("Revoked cookie retained me access.");
    const staleDashboard = await get("/member/profile", cookie);
    const dashboardBody = await staleDashboard.text();
    const httpRedirect = [302, 303, 307, 308].includes(staleDashboard.status) && staleDashboard.headers.get("location")?.includes("/login");
    const streamedRedirect = staleDashboard.status === 200 && /<meta[^>]+id="__next-page-redirect"[^>]+content="[^\"]*url=\/login"/.test(dashboardBody);
    if (!httpRedirect && !streamedRedirect) throw new SmokeFailure(`Revoked-cookie dashboard failed redirect verification (status ${staleDashboard.status}, redirectDigest=${dashboardBody.includes("NEXT_REDIRECT;replace;/login;")}).`);
    phase = "Redis outage readiness";
    redisFixture.setAvailable(false);
    const outageDeadline = Date.now() + 8000;
    let unavailable;
    do { await delay(250); unavailable = await get("/api/health/ready"); } while (unavailable.status === 200 && Date.now() < outageDeadline);
    if (unavailable.status !== 503 || (await unavailable.json()).checks.redis !== false || (await get("/api/health")).status !== 200) throw new SmokeFailure("Redis outage was not distinguished from process liveness.");
    return { standaloneHttp: "PASS", firstHealthMs, firstHealthLimitMs: 30_000, catalogSql: "PASS", productServerRender: "PASS", savedCustomDomainGallery: "PASS", packagedAssets: "PASS", unauthenticatedAdminRedirect: "PASS", configuredLogin: "PASS", readiness: "PASS", redisOutageReadiness: "PASS", signedProfileRead: "PASS", copiedCookieRevocation: "PASS", revokedDashboardRedirect: "PASS" };
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    const allowedCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);
    const code = allowedCodes.has(error?.cause?.code) ? error.cause.code : "unclassified";
    const kind = ["AbortError", "TimeoutError", "TypeError"].includes(error?.name) ? error.name : "Error";
    throw new SmokeFailure(`Standalone HTTP/SQL smoke failed during ${phase} (${kind}, ${code}, childExit=${child?.exitCode ?? "running"}).`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(5_000, undefined, { ref: false })]);
    }
    try {
      if (product) await db.product.delete({ where: { id: product.id } });
      if (category) await db.category.delete({ where: { id: category.id } });
      if (seller) await db.user.delete({ where: { id: seller.id } });
    } finally { await db.$disconnect(); await redisFixture?.close(); process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error instanceof SmokeFailure ? error.message : "Standalone HTTP/SQL smoke failed. Check the local database, build output and test environment; fixture cleanup was attempted."); process.exitCode = 1; });
