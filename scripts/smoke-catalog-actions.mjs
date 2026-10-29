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
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search) throw new Error("Use an isolated local audit_* database.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }) });
  const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex");
  const prefix = `audit-action-${randomUUID()}`;
  let redis, child, admin, seller, category, product;
  const campaigns = [];
  try {
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url);
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, password: await hashPassword(password), role: "ADMIN", isVerified: true } });
    seller = await db.user.create({ data: { email: `${prefix}-seller@example.invalid`, role: "MEMBER", isVerified: true, sellerStatus: "APPROVED" } });
    category = await db.category.create({ data: { name: prefix, slug: prefix } });
    product = await db.product.create({ data: { name: prefix, slug: prefix, price: 100, stock: 1, sellerId: seller.id, categoryId: category.id, imageUrl: "https://media.example.invalid/front.png", images: ["https://media.example.invalid/front.png"] } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    phase = "prepared server startup";
    child = await startStandaloneFixture(url.toString(), redis, { TRUSTED_PROXY_SECRET: secret });
    assert.equal((await requestHttp(child.origin + "/api/health")).status, 200);
    const assertion = (target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method: "POST", target });
    phase = "actual administrator login";
    const login = await requestHttp(child.origin + "/api/auth/login", { method: "POST", headers: { Origin: child.origin, "Content-Type": "application/json", ...assertion("/api/auth/login") }, body: JSON.stringify({ email: admin.email, password }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.equal(login.status, 200); assert.ok(cookie);
    // Inspect only action metadata; never print the manifest's encryption key.
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    for (const retired of ["createProductAction", "getProductBySlug", "processOrderCheckout"]) assert.ok(!Object.values(manifest.node).some((value) => value.exportedName === retired), `Retired action ${retired} was compiled`);
    const call = async (name, args, route = "/admin/products", worker = "app/(dashboard)/admin/products/page") => {
      const reference = Object.entries(manifest.node).find(([, value]) => value.exportedName === name && value.workers?.[worker]);
      assert.ok(reference, `Missing compiled action ${name}`);
      const response = await requestHttp(child.origin + route, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Content-Type": "text/plain;charset=UTF-8", "Next-Action": reference[0], ...assertion(route) }, body: JSON.stringify(args) });
      if (response.status >= 500) console.error(JSON.stringify({ event: "catalog_action_failure_diagnostics", ...child.diagnostics() }));
      assert.equal(response.status, 200);
      const body = await response.text();
      for (const line of body.split("\n")) {
        if (!/^[a-f0-9]+:\{/.test(line)) continue;
        try { const result = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof result.success === "boolean") return result; } catch { /* Other Flight rows are not the action result. */ }
      }
      throw new Error("No serialized action result was returned.");
    };
    phase = "malformed direct Server Action requests";
    const before = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal((await call("adminUpdateProductPrice", [product.id, "12.00", null])).success, false);
    assert.equal((await call("adminUpdateProductPrice", [product.id, 100, 200])).success, false);
    assert.equal((await call("updateProductStatus", [product.id, "PAID"])).success, false);
    assert.deepEqual(await db.product.findUniqueOrThrow({ where: { id: product.id } }), before);
    phase = "actual create-action validation";
    assert.equal((await call("createProduct", [{ name: prefix, price: 100, stock: 1, categoryId: category.id, uploadKeys: [], status: "APPROVED" }], "/member/add-product", "app/(dashboard)/member/add-product/page")).success, false);
    phase = "price serialization and database write";
    const priced = await call("adminUpdateProductPrice", [product.id, 123.45, 99.99]);
    assert.equal(priced.success, true); assert.equal(priced.data.price, 123.45); assert.equal(priced.data.discountPrice, 99.99);
    const saved = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(saved.price.toString(), "123.45"); assert.equal(saved.discountPrice.toString(), "99.99");
    phase = "valid product approval";
    phase = "actual compiled specification mutation";
    assert.equal((await call("adminUpdateSpecifications", [{ productId: product.id, specifications: [{ label: "Storage", value: "512 GB" }] }])).success, true);
    assert.deepEqual((await db.product.findUniqueOrThrow({ where: { id: product.id } })).specifications, [{ label: "Storage", value: "512 GB" }]);
    assert.equal((await call("adminUpdateSpecifications", [{ productId: product.id, specifications: [{ label: "Storage", value: "" }] }])).success, false);
    phase = "valid product approval";
    assert.equal((await call("updateProductStatus", [product.id, "APPROVED"])).success, true);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status, "APPROVED");
    phase = "compiled campaign CRUD and public window enforcement";
    const campaignCall = (name, args) => call(name, args, "/admin/campaigns", "app/(dashboard)/admin/campaigns/page");
    const fields = { title: `${prefix} actual campaign`, slug: `${prefix}-campaign`, description: "Current catalog prices", startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), isActive: true, productIds: [product.id] };
    const created = await campaignCall("saveCampaign", [{ fields }]); assert.equal(created.success, true); campaigns.push(created.data.id);
    const get = (target) => requestHttp(child.origin + target, { headers: signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method: "GET", target }) });
    assert.ok((await (await get("/deals")).text()).includes(fields.title)); assert.ok((await (await get("/")).text()).includes(fields.title));
    assert.equal((await campaignCall("saveCampaign", [{ id: created.data.id, version: 1, fields: { ...fields, isActive: false } }])).success, true);
    assert.ok(!(await (await get("/deals")).text()).includes(fields.title)); assert.ok(!(await (await get("/")).text()).includes(fields.title));
    assert.equal((await campaignCall("saveCampaign", [{ id: created.data.id, version: 1, fields }])).success, false);
    assert.equal((await campaignCall("saveCampaign", [{ id: created.data.id, version: 2, fields: { ...fields, endsAt: new Date(Date.now() - 1).toISOString() } }])).success, true);
    assert.ok(!(await (await get("/deals")).text()).includes(fields.title));
    const draft = await campaignCall("saveCampaign", [{ fields: { ...fields, slug: `${prefix}-draft`, isActive: false, productIds: [] } }]); assert.equal(draft.success, true); campaigns.push(draft.data.id);
    assert.equal((await campaignCall("deleteCampaign", [{ id: draft.data.id, version: 1 }])).success, true); assert.equal(await db.campaign.count({ where: { id: draft.data.id } }), 0);
    phase = "copied administrator cookie revocation";
    await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    const revoked = await call("adminUpdateProductPrice", [product.id, 1, null]);
    assert.equal((await call("adminUpdateSpecifications", [{ productId: product.id, specifications: [] }])).success, false);
    assert.equal((await campaignCall("deleteCampaign", [{ id: created.data.id, version: 3 }])).success, false); assert.equal(await db.campaign.count({ where: { id: created.data.id } }), 1);
    assert.equal(revoked.success, false); assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).price.toString(), "123.45");
    return { compiledNextActionTransport: "PASS", malformedRequestsLeaveProductUnchanged: "PASS", directCreateValidation: "PASS", serializablePriceResult: "PASS", exactPriceSqlWrite: "PASS", specificationSqlMutation: "PASS", invalidAndRevokedSpecMutationDenied: "PASS", validApproval: "PASS", campaignCrudSqlAndPublicRender: "PASS", disabledExpiredAndStaleCampaignDenied: "PASS", copiedAdminCookieRevoked: "PASS" };
  } finally {
    await child?.stop(); await redis?.close();
    await db.campaign.deleteMany({ where: { id: { in: campaigns } } });
    try { if (product) await db.product.deleteMany({ where: { id: product.id } }); if (category) await db.category.delete({ where: { id: category.id } }); if (admin) await db.user.delete({ where: { id: admin.id } }); if (seller) await db.user.delete({ where: { id: seller.id } }); } finally { await db.$disconnect(); }
  }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : "";
  console.error(`Catalog Server Action smoke failed during ${phase}${detail}. Private child output and manifest key were not published.`); process.exitCode = 1;
});
