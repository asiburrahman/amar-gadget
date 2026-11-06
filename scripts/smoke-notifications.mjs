import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "new isolated notification database";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis, worker;
  async function stopWorker() { if (worker && worker.exitCode === null && worker.signalCode === null) { worker.kill(); await Promise.race([new Promise((done) => worker.once("exit", done)), delay(5000, undefined, { ref: false })]); } }
  try {
    const secret = randomBytes(32).toString("hex"), maintenance = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [admin, seller, other, buyer] = await Promise.all(["ADMIN", "MEMBER", "MEMBER", "USER"].map((role, index) => db.user.create({ data: { email: `${randomUUID()}@notification-smoke.example.invalid`, role, isVerified: true, password: hash, sellerStatus: index === 1 ? "PENDING" : "APPROVED" } })));
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret, CHECKOUT_SWEEP_SECRET: maintenance });
    const signature = (method, target) => signIngress({ secret, origin: child.origin, ip: "127.0.0.1", method, target });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signature(method, target), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (actor) => { const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const moderator = await login(admin), pending = await login(seller), foreign = await login(other), customer = await login(buyer), path = "/api/notifications", queuePath = "/api/admin/notifications/queue", workerPath = "/api/internal/notifications/deliver";
    const headers = (actor) => ({ "X-Notification-Owner": actor.id });
    const inbox = async (actor, cookie, query = "") => { const response = await send(path + query, "GET", undefined, cookie, headers(actor)); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.ok(response.headers.get("x-robots-tag")?.includes("noindex")); return response.json(); };
    const deliver = async () => { const response = await requestHttp(child.origin + workerPath, { method: "POST", headers: { authorization: `Bearer ${maintenance}`, ...signature("POST", workerPath) } }); assert.equal(response.status, 200); return response.json(); };
    async function drain() { for (let index = 0; index < 10; index++) if (!(await deliver()).checked) return; throw new Error("Notification fixture did not reach a bounded delivery checkpoint"); }
    phase = "private owner boundary and dual worker authentication";
    assert.equal((await send(path)).status, 403); assert.equal((await send(path, "GET", undefined, customer, headers(seller))).status, 409); assert.equal((await requestHttp(child.origin + workerPath, { method: "POST", headers: { authorization: `Bearer ${maintenance}` } })).status, 403);
    assert.equal((await requestHttp(child.origin + workerPath, { method: "POST", headers: signature("POST", workerPath) })).status, 401); assert.equal((await inbox(seller, pending)).total, 0);
    phase = "actual packaged supervised worker delivers a committed seller application";
    await readFile(".next/standalone/scripts/notification-delivery-worker.mjs", "utf8");
    const system = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "USERPROFILE"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    worker = spawn(process.execPath, [resolve(".next/standalone/scripts/notification-delivery-worker.mjs")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...system, APP_URL: child.origin, CHECKOUT_SWEEP_ORIGIN: child.origin, CHECKOUT_SWEEP_SECRET: maintenance, TRUSTED_PROXY_SECRET: secret } });
    let workerResult, failed = false, output = ""; worker.on("error", () => { failed = true; }); worker.stderr.on("data", () => {}); worker.stdout.on("data", (chunk) => { output += chunk.toString(); for (const line of output.split("\n")) { try { const parsed = JSON.parse(line); if (parsed.event === "notification_delivery") workerResult = parsed; } catch { /* Partial log line. */ } } });
    const deadline = Date.now() + 20_000; while (!workerResult && Date.now() < deadline) { if (failed || worker.exitCode !== null) throw new Error("Packaged notification worker stopped before confirmed delivery"); await delay(50); } assert.ok(workerResult?.inserted > 0); await stopWorker();
    assert.ok((await inbox(admin, moderator)).rows.some((row) => row.kind === "SELLER_APPLICATION"));
    phase = "real account approval revokes the old session and queues a readable seller decision";
    const observed = await db.user.findUniqueOrThrow({ where: { id: seller.id } }), approval = await send("/api/admin/accounts", "POST", { action: "seller-status", id: seller.id, version: observed.administrationVersion, requestId: randomUUID(), reason: "Reviewed actual seller application", sellerStatus: "APPROVED", confirmed: true }, moderator, { "X-Account-Owner": admin.id }); assert.equal(approval.status, 200);
    assert.equal((await send(path, "GET", undefined, pending, headers(seller))).status, 403); const vendor = await login(seller);
    const category = await db.category.create({ data: { name: "Native notification category", slug: randomUUID() } });
    const products = await Promise.all([seller, other].map((owner, index) => db.product.create({ data: { name: `Actual notification fixture gadget ${index}`, slug: randomUUID(), price: 100 + index * 100, stock: 10, sellerId: owner.id, categoryId: category.id, status: index ? "APPROVED" : "PENDING_APPROVAL", imageUrl: "https://media.example.invalid/front.png", images: ["https://media.example.invalid/front.png"] } })));
    const manifest = JSON.parse(await readFile(".next/standalone/.next/server/server-reference-manifest.json", "utf8"));
    async function call(name, args, cookie, route, workerPath) {
      const action = Object.entries(manifest.node).find(([, value]) => value.exportedName === name && value.workers?.[workerPath]); assert.ok(action);
      const response = await requestHttp(child.origin + route, { method: "POST", headers: { Cookie: cookie, Origin: child.origin, "Next-Action": action[0], "Content-Type": "text/plain;charset=UTF-8", ...signature("POST", route) }, body: JSON.stringify(args) }); assert.equal(response.status, 200);
      for (const line of (await response.text()).split("\n")) { if (!/^[a-f0-9]+:\{/.test(line)) continue; try { const result = JSON.parse(line.slice(line.indexOf(":") + 1)); if (typeof result.success === "boolean") return result; } catch { /* Other Flight rows. */ } } throw new Error("Compiled notification source action returned no result");
    }
    phase = "compiled approval and multi-vendor COD checkout enqueue actual source events";
    assert.equal((await call("updateProductStatus", [products[0].id, "APPROVED", products[0].catalogVersion], moderator, "/admin/products", "app/(dashboard)/admin/products/page")).success, true);
    let cart = await (await send("/api/cart", "GET", undefined, customer, { "X-Cart-Owner": buyer.id })).json();
    for (const product of products) { const response = await send("/api/cart", "POST", { action: "set", productId: product.id, lineId: null, quantity: 1, version: cart.version, requestId: randomUUID() }, customer, { "X-Cart-Owner": buyer.id }); assert.equal(response.status, 200); cart = await response.json(); }
    cart = await (await send("/api/cart", "GET", undefined, customer, { "X-Cart-Owner": buyer.id })).json();
    const context = { ownerId: buyer.id, sourceId: null, version: cart.version, couponCode: cart.couponCode, couponVersion: cart.couponVersion, previousReceiptId: null, lines: cart.lines.map((line) => ({ productId: line.id, lineId: line.lineId, quantity: 1 })) };
    const purchase = await call("createOrder", [{ cart: context, items: products.map((product) => ({ productId: product.id, quantity: 1 })), fullName: "Private native recipient", phone: "01700000000", street: "Private fixture destination", city: "Dhaka", district: "Dhaka", paymentMethod: "COD", checkoutToken: randomBytes(32).toString("hex") }], customer, "/checkout", "app/(marketing)/checkout/page"); assert.equal(purchase.success, true); await drain();
    const customerInbox = await inbox(buyer, customer), sellerInbox = await inbox(seller, vendor), otherInbox = await inbox(other, foreign);
    assert.ok(customerInbox.rows.some((row) => row.kind === "ORDER_PLACED")); assert.ok(sellerInbox.rows.some((row) => row.kind === "SELLER_STATUS")); assert.ok(sellerInbox.rows.some((row) => row.kind === "PRODUCT_STATUS")); assert.ok(sellerInbox.rows.some((row) => row.kind === "SHIPMENT_ASSIGNED"));
    for (const privateValue of [buyer.email, other.id, products[1].id, "01700000000", "Private fixture destination"]) assert.ok(!JSON.stringify(sellerInbox).includes(privateValue));
    phase = "foreign/batch read isolation, exact unread state and stale reversal rejection";
    const ownNotice = customerInbox.rows.find((row) => row.kind === "ORDER_PLACED"), sellerNotice = sellerInbox.rows[0], foreignNotice = otherInbox.rows[0];
    assert.equal((await send(path, "POST", { action: "read", id: foreignNotice.id, version: foreignNotice.readVersion }, vendor, headers(seller))).status, 404);
    assert.equal((await send(path, "POST", { action: "read-page", entries: [{ id: sellerNotice.id, version: sellerNotice.readVersion }, { id: ownNotice.id, version: ownNotice.readVersion }] }, vendor, headers(seller))).status, 404); assert.equal((await inbox(seller, vendor)).unread, sellerInbox.unread);
    const mark = { action: "read", id: ownNotice.id, version: ownNotice.readVersion }; for (const changed of [1, 0]) { const response = await send(path, "POST", mark, customer, headers(buyer)); assert.equal(response.status, 200); assert.equal((await response.json()).changed, changed); }
    assert.equal((await send(path, "POST", { action: "unread", id: ownNotice.id, version: 0 }, customer, headers(buyer))).status, 409);
    const savedNotice = (await inbox(buyer, customer)).rows.find((row) => row.id === ownNotice.id); assert.equal((await send(path, "POST", { action: "unread", id: ownNotice.id, version: savedNotice.readVersion }, customer, headers(buyer))).status, 200); assert.equal((await inbox(buyer, customer)).unread, customerInbox.unread);
    phase = "real payment-source delivery failure and audited administrator recovery";
    await db.$executeRawUnsafe(`CREATE TABLE "NotificationNativeFailure"(blocked BOOLEAN NOT NULL); INSERT INTO "NotificationNativeFailure" VALUES (true); CREATE FUNCTION notification_native_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='PAYMENT_STATUS' AND EXISTS(SELECT 1 FROM "NotificationNativeFailure" WHERE blocked) THEN RAISE EXCEPTION 'Isolated native delivery failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER "Notification_native_failure" BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION notification_native_failure();`);
    for (const [actor, cookie] of [[seller, vendor], [other, foreign]]) {
      const response = await send(`/api/member/fulfillments?orderId=${purchase.orderId}`, "GET", undefined, cookie, { "X-Fulfillment-Owner": actor.id }); assert.equal(response.status, 200); const shipment = (await response.json()).shipments[0];
      const sent = await send("/api/member/fulfillments", "POST", { action: "ship", fulfillmentId: shipment.id, version: shipment.version, carrier: "Actual test courier", trackingNumber: randomUUID() }, cookie, { "X-Fulfillment-Owner": actor.id }); assert.equal(sent.status, 200); const shipped = (await sent.json()).shipment;
      assert.equal((await send("/api/admin/fulfillments", "POST", { action: "deliver", fulfillmentId: shipped.id, version: shipped.version, codMoneyReceived: true }, moderator, { "X-Fulfillment-Owner": admin.id })).status, 200);
    }
    await drain(); assert.equal((await send(queuePath, "GET", undefined, vendor, headers(seller))).status, 403);
    const queueResponse = await send(queuePath, "GET", undefined, moderator, headers(admin)); assert.equal(queueResponse.status, 200); const queue = await queueResponse.json(), failedEvent = queue.rows.find((row) => row.kind === "PAYMENT_STATUS" && row.recipientId === buyer.id); assert.ok(failedEvent); assert.equal(failedEvent.deliveredRecipients, 0);
    await db.$executeRaw`UPDATE "NotificationNativeFailure" SET blocked=false`;
    const retryBody = { id: failedEvent.id, version: failedEvent.version, reason: "Verified actual local database delivery recovery" };
    const retried = await send(queuePath, "POST", retryBody, moderator, headers(admin)); assert.equal(retried.status, 200); assert.equal((await retried.json()).requeued, true); await drain();
    const paymentNotice = (await inbox(buyer, customer)).rows.filter((row) => row.kind === "PAYMENT_STATUS"); assert.equal(paymentNotice.length, 1); assert.ok(paymentNotice[0].body.includes("paid")); assert.equal(await db.notificationRetryEvent.count({ where: { eventId: failedEvent.id } }), 1);
    phase = "real role pages and current-role removal of privileged inbox content";
    for (const [route, cookie, title] of [["/user/notifications", customer, "Customer notifications"], ["/member/notifications", vendor, "Seller notifications"], ["/admin/notifications", moderator, "Administrator notifications"], ["/admin/notifications/delivery", moderator, "Notification delivery and recovery"]]) { phase = `role page ${route}`; const response = await send(route, "GET", undefined, cookie); assert.equal(response.status, 200); const html = await response.text(), headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1].replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim()); assert.ok(headings.includes(title)); }
    phase = "privileged inbox before role change"; const privileged = (await inbox(admin, moderator)).rows.find((row) => row.audience === "ADMIN"); assert.ok(privileged); await db.user.update({ where: { id: admin.id }, data: { role: "USER" } }); assert.equal((await send(path, "GET", undefined, moderator, headers(admin))).status, 403);
    phase = "current user role cannot read former administrator messages";
    const changedRole = await login(admin); await drain(); const personal = await inbox(admin, changedRole); assert.ok(personal.rows.every((row) => row.audience === "ACCOUNT")); assert.equal((await send(path, "POST", { action: "read", id: privileged.id, version: privileged.readVersion }, changedRole, headers(admin))).status, 404); assert.equal((await send(queuePath, "GET", undefined, changedRole, headers(admin))).status, 403);
    return { fresh32MigrationDatabase: "PASS", packagedSupervisedWorkerAndDualAuthentication: "PASS", realSellerApprovalAndRevokedCookie: "PASS", compiledProductApprovalAndMixedCheckoutSources: "PASS", capturedSellerAndAccountPrivacy: "PASS", exactReadUnreadAndAtomicForeignBatchDenial: "PASS", actualPaymentDeliveryFailureAndAuditedRetry: "PASS", realThreeRoleInboxAndRecoveryPages: "PASS", changedRoleCannotReadFormerAdminAudience: "PASS" };
  } finally { await stopWorker(); await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Notification smoke failed during ${phase}${detail}; private credentials, payloads and child output were not published.`); process.exitCode = 1; });
