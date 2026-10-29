import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  const ingress = randomBytes(32).toString("hex"), maintenance = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), prefix = `audit-gallery-smoke-${randomUUID()}`;
  let child, redis, seller, admin, category, product;
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url);
    const hashed = await hashPassword(password);
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, password: hashed, role: "MEMBER", sellerStatus: "APPROVED", isVerified: true } });
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, password: hashed, role: "ADMIN", isVerified: true } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    // SQL fixture keys exercise retained-image transport; decoded new uploads
    // and real signed SDK HTTP are covered by the separate integration suite.
    const images = [1, 2].map(() => `https://cdn.media.example.invalid/products/${seller.id}/${randomUUID()}.png`);
    product = await db.product.create({ data: { name: prefix, slug: prefix, sellerId: seller.id, categoryId: category.id, price: 100, stock: 1, imageUrl: images[0], images, status: "APPROVED" } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    phase = "prepared artifact startup";
    child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: ingress, CHECKOUT_SWEEP_SECRET: maintenance });
    await readFile(".next/standalone/scripts/media-cleanup-worker.mjs", "utf8");
    const signature = (method, target) => signIngress({ secret: ingress, origin: child.origin, ip: "127.0.0.1", method, target });
    const login = async (email) => {
      const path = "/api/auth/login";
      const response = await requestHttp(child.origin + path, { method: "POST", headers: { Origin: child.origin, "Content-Type": "application/json", ...signature("POST", path) }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie;
    };
    const sellerCookie = await login(seller.email), adminCookie = await login(admin.email);
    const path = `/member/products/${product.id}/images`;
    const get = (target, cookie) => requestHttp(child.origin + target, { headers: { Cookie: cookie, ...signature("GET", target) } });
    phase = "actual owner gallery page";
    const pageResponse = await get(path, sellerCookie), page = await pageResponse.text();
    phase = `owner page status ${pageResponse.status}`; assert.equal(pageResponse.status, 200);
    phase = "owner page save control"; assert.ok(page.includes("Save gallery"));
    phase = "owner page custom media URL"; assert.ok(page.includes(images[0]));
    phase = "owner page custom CDN direct delivery"; assert.ok(!page.includes("/_next/image?url=https%3A%2F%2Fcdn.media"));
    phase = "paged owner index link";
    assert.ok((await (await get("/member/products", sellerCookie)).text()).includes(`href="${path}"`));
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    const call = async (name, args, cookie, target = path, worker = "app/(dashboard)/member/products/[id]/images/page") => {
      const reference = Object.entries(manifest.node).find(([, value]) => value.exportedName === name && value.workers?.[worker]);
      assert.ok(reference, `Missing compiled action ${name}`);
      const response = await requestHttp(child.origin + target, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Content-Type": "text/plain;charset=UTF-8", "Next-Action": reference[0], ...signature("POST", target) }, body: JSON.stringify(args) });
      assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) {
        if (!/^[a-f0-9]+:\{/.test(line)) continue;
        try { const result = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof result.success === "boolean") return result; } catch { /* Other Flight rows. */ }
      }
      throw new Error("No serialized action result.");
    };
    const input = { productId: product.id, version: 1, items: [{ source: "existing", url: images[1] }] };
    phase = "ownership and actual compiled gallery mutation";
    assert.equal((await call("replaceProductGallery", [input], adminCookie)).success, false);
    assert.equal((await call("replaceProductGallery", [input], sellerCookie)).success, true);
    const saved = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(saved.mediaVersion, 2); assert.equal(saved.status, "PENDING_APPROVAL"); assert.deepEqual(saved.images, [images[1]]);
    assert.equal((await call("replaceProductGallery", [input], sellerCookie)).success, false);
    assert.equal(await db.productImageCleanup.count({ where: { ownerId: seller.id } }), 1);
    phase = "private cleanup ingress and Bearer authentication";
    const endpoint = "/api/internal/media/cleanup";
    assert.equal((await requestHttp(child.origin + endpoint, { method: "POST", headers: { authorization: `Bearer ${maintenance}` } })).status, 403);
    assert.equal((await requestHttp(child.origin + endpoint, { method: "POST", headers: signature("POST", endpoint) })).status, 401);
    const clean = await requestHttp(child.origin + endpoint, { method: "POST", headers: { authorization: `Bearer ${maintenance}`, ...signature("POST", endpoint) } });
    assert.equal(clean.status, 200); assert.equal((await clean.json()).inspected, 0);
    phase = "actual administrator delete and durable queue";
    assert.equal((await call("adminDeleteProduct", [product.id], adminCookie, "/admin/products", "app/(dashboard)/admin/products/page")).success, true);
    assert.equal(await db.productImageCleanup.count({ where: { ownerId: seller.id } }), 2);
    phase = "revoked seller cookie";
    await db.user.update({ where: { id: seller.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal((await call("replaceProductGallery", [input], sellerCookie)).success, false);
    return { preparedOwnerGallery: "PASS", actualCompiledGalleryAction: "PASS", foreignStaleAndRevokedDenied: "PASS", approvalVersionAndDurableQueue: "PASS", cleanupDualAuthentication: "PASS", compiledAdminDeletionQueuesOwnerImages: "PASS", packagedMediaWorker: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    try {
      if (seller) { await db.productImageCleanup.deleteMany({ where: { ownerId: seller.id } }); await db.product.deleteMany({ where: { sellerId: seller.id } }); }
      if (category) await db.category.delete({ where: { id: category.id } });
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
    } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch(() => { console.error(`Media lifecycle smoke failed during ${phase}. Private child output and manifest keys were not published.`); process.exitCode = 1; });
