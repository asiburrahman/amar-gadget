import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "isolated administrator fixture";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [admin, seller, buyer] = await Promise.all(["ADMIN", "MEMBER", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@admin-smoke.example.invalid`, role, isVerified: true, password: hash, sellerStatus: role === "MEMBER" ? "PENDING" : "APPROVED" } })));
    const category = await db.category.create({ data: { name: "Management smoke category", slug: randomUUID() } });
    const product = await db.product.create({ data: { name: "Seller moderation visibility fixture", slug: randomUUID(), price: 100, stock: 10, sellerId: seller.id, categoryId: category.id, status: "APPROVED" } });
    const first = await db.order.create({ data: { userId: buyer.id, total: 100, paymentMethod: "STRIPE", paymentStatus: "PAID", disputeStatus: "LOST", disputeAmountCents: BigInt(2500), createdAt: new Date("2026-11-01T18:00:00Z"), items: { create: [{ productId: product.id, quantity: 1, price: 100 }] } } });
    await db.order.create({ data: { userId: buyer.id, total: 150, paymentMethod: "COD", paymentStatus: "UNPAID", createdAt: new Date("2026-11-02T17:59:59Z") } });
    await db.order.create({ data: { userId: buyer.id, total: 40, paymentMethod: "COD", paymentStatus: "UNPAID", createdAt: new Date("2026-11-02T18:00:00Z") } });
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (account) => { const response = await send("/api/auth/login", "POST", { email: account.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const moderator = await login(admin), copiedModerator = await login(admin), pendingSeller = await login(seller), customer = await login(buyer), owner = { "X-Account-Owner": admin.id }, path = "/api/admin/accounts";
    const revoked = async (cookie, id) => { const response = await send("/api/auth/me", "GET", undefined, cookie); assert.equal(response.status, 200); const session = await response.json(); assert.equal(session.success, false); assert.equal(session.user, null); assert.equal((await send("/api/cart", "GET", undefined, cookie, { "X-Cart-Owner": id })).status, 401); };
    const identity = async (id) => ({ id, version: (await db.user.findUniqueOrThrow({ where: { id } })).administrationVersion, requestId: randomUUID(), confirmed: true, reason: "Reviewed actual account administration evidence" });
    const mutate = async (body, cookie = moderator, observed = owner) => { const response = await send(path, "POST", body, cookie, observed); assert.equal(response.status, 200, `Account ${body.action} returned ${response.status}`); return response.json(); };
    phase = "actual directory scope, last-administrator and owner/role guards";
    const all = await send(`${path}?scope=accounts`, "GET", undefined, moderator, owner); assert.equal(all.status, 200); const directory = await all.json(); assert.equal(directory.total, 3); assert.ok(directory.rows.every((row) => !Object.hasOwn(row, "password"))); assert.equal(all.headers.get("cache-control"), "private, no-store");
    const members = await send(`${path}?scope=members`, "GET", undefined, moderator, owner); assert.deepEqual((await members.json()).rows.map((row) => row.id), [seller.id]);
    assert.equal((await send(path, "POST", { ...await identity(admin.id), action: "role", role: "USER" }, moderator, owner)).status, 409);
    assert.equal((await send(path, "GET", undefined, customer, { "X-Account-Owner": buyer.id })).status, 403); assert.equal((await send(path, "GET", undefined, moderator, { "X-Account-Owner": buyer.id })).status, 409);
    phase = "seller moderation, exact receipts, real cookie revocation and catalog visibility";
    const initialProducts = await send("/api/products"); assert.ok(!(await initialProducts.json()).products.some((row) => row.id === product.id));
    const approval = { ...await identity(seller.id), action: "seller-status", sellerStatus: "APPROVED" }, approved = await mutate(approval); assert.equal((await mutate(approval)).result.version, approved.result.version);
    await revoked(pendingSeller, seller.id); const currentSeller = await login(seller);
    const visible = await send("/api/products"); assert.ok((await visible.json()).products.some((row) => row.id === product.id));
    assert.equal((await send(path, "POST", { ...approval, sellerStatus: "BLOCKED" }, moderator, owner)).status, 409);
    await mutate({ ...await identity(seller.id), action: "seller-status", sellerStatus: "BLOCKED" }); await revoked(currentSeller, seller.id);
    const hidden = await send("/api/products"); assert.ok(!(await hidden.json()).products.some((row) => row.id === product.id));
    await mutate({ ...await identity(seller.id), action: "seller-status", sellerStatus: "APPROVED" });
    phase = "compiled cohort report, exact CSV and real overview pages";
    const query = `from=2026-11-02&to=2026-11-02&customerId=${buyer.id}`, reportsOwner = { "X-Reports-Owner": admin.id };
    const reportResponse = await send(`/api/admin/reports?${query}`, "GET", undefined, moderator, reportsOwner); assert.equal(reportResponse.status, 200); const report = await reportResponse.json(); assert.equal(report.summary.orders, 2); assert.equal(report.summary.grossOrderCents, 25000); assert.equal(report.summary.netFullyCollectedCents, 7500); assert.equal(report.rows.find((row) => row.id === first.id).lostDisputeCents, 2500); assert.equal(report.daily.length, 1); assert.equal(report.daily[0].day, "2026-11-02");
    const exported = await send(`/api/admin/reports?${query}&format=csv`, "GET", undefined, moderator, reportsOwner); assert.equal(exported.status, 200); assert.equal(exported.headers.get("content-type"), "text/csv; charset=utf-8"); assert.equal(exported.headers.get("cache-control"), "private, no-store"); const csv = await exported.text(); assert.ok(csv.includes('"75.00"')); assert.ok(csv.includes(first.id)); assert.ok(!csv.includes(buyer.email));
    const analytics = await send("/api/analytics", "GET", undefined, moderator, { "X-Analytics-Owner": admin.id }); assert.equal(analytics.status, 200); assert.equal((await analytics.json()).overview.paidRevenueCents, 7500);
    for (const page of ["/admin", "/admin/users", "/admin/members", "/admin/reports", "/admin/analytics"]) { const response = await send(page, "GET", undefined, moderator); assert.equal(response.status, 200); if (page.endsWith("analytics")) { const html = await response.text(); assert.ok(html.includes("BDT 75.00")); for (const invented of ["8.45M", "12,450", "99.98%", "24.2%", "100% Uptime"]) assert.ok(!html.includes(invented)); } }
    const retained = await send("/admin/sellers", "GET", undefined, moderator); if (retained.status === 200) assert.ok((await retained.text()).includes("NEXT_REDIRECT;replace;/admin/members;307;")); else { assert.equal(retained.status, 307); assert.equal(new URL(retained.headers.get("location"), child.origin).pathname, "/admin/members"); }
    assert.equal((await send(`/api/admin/reports?${query}`, "GET", undefined, customer, { "X-Reports-Owner": buyer.id })).status, 403);
    phase = "real role transitions, retained orders and private audit without credential values";
    await mutate({ ...await identity(buyer.id), action: "role", role: "MEMBER" }); assert.equal((await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).sellerStatus, "PENDING"); await revoked(customer, buyer.id);
    await mutate({ ...await identity(buyer.id), action: "role", role: "USER" }); assert.equal(await db.order.count({ where: { userId: buyer.id } }), 3);
    const history = await send(`${path}?mode=history&id=${seller.id}`, "GET", undefined, moderator, owner); assert.equal(history.status, 200); const evidence = await history.json(); assert.equal(evidence.events.length, 3); assert.ok(evidence.events.every((event) => event.actorId === admin.id && event.reason)); assert.ok(!JSON.stringify(evidence).includes(hash)); assert.ok(!JSON.stringify(evidence).includes("password"));
    assert.equal((await send(path, "POST", { ...await identity(seller.id), action: "revoke-sessions" }, moderator, { ...owner, Origin: "https://wrong.example.invalid" })).status, 403);
    phase = "confirmed self-demotion, copied-cookie denial and retained final administrator";
    await mutate({ ...await identity(buyer.id), action: "role", role: "ADMIN" }); const promoted = await login(buyer);
    const demotion = await mutate({ ...await identity(admin.id), action: "role", role: "USER" }); assert.equal(demotion.result.sessionChanged, true);
    for (const cookie of [moderator, copiedModerator]) assert.equal((await send(path, "GET", undefined, cookie, owner)).status, 403);
    const last = await send(path, "POST", { ...await identity(buyer.id), action: "role", role: "USER" }, promoted, { "X-Account-Owner": buyer.id }); assert.equal(last.status, 409); assert.equal(await db.user.count({ where: { role: "ADMIN", isVerified: true } }), 1);
    return { realDirectoryScopesAndLastAdminGuard: "PASS", sellerModerationReceiptsCatalogAndCookieRevocation: "PASS", compiledCohortCsvAnalyticsAndPages: "PASS", roleHistoryPrivacyAndRetainedPurchases: "PASS", selfDemotionCopiedSessionsAndFinalAdminSafety: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.error(`Administrator smoke failed during ${phase}: ${error?.code === "ERR_ASSERTION" ? error.message : "private diagnostic withheld"}. Private child output and credentials were not published.`); process.exitCode = 1; });
