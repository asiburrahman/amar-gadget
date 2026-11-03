import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { startSmtpFixture } from "./testing/smtp-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "new isolated newsletter database";
function mailBody(raw) {
  const index = raw.indexOf("\r\n\r\n"), headers = raw.slice(0, index), body = raw.slice(index + 4);
  if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  return body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function capability(message, action) {
  const body = mailBody(message.raw), link = body.match(new RegExp(`https?://[^\\s<>]+/newsletter/${action}#token=[A-Za-z0-9_.%-]+`))?.[0];
  assert.ok(link); const url = new URL(link); assert.equal(url.search, ""); const token = new URLSearchParams(url.hash.slice(1)).get("token"); assert.ok(token); return { token, url };
}
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis, smtp, worker, sequence = 1, workerConfirmed = false;
  async function stopWorker() { if (worker && worker.exitCode === null && worker.signalCode === null) { worker.kill(); await Promise.race([new Promise((done) => worker.once("exit", done)), delay(5000, undefined, { ref: false })]); } }
  async function elapsed(id) {
    await db.$transaction(async (tx) => { await tx.$executeRawUnsafe('ALTER TABLE "NewsletterSubscriber" DISABLE TRIGGER "NewsletterSubscriber_guard"'); await tx.newsletterSubscriber.update({ where: { id }, data: { lastRequestedAt: new Date(Date.now() - 61_000) } }); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); await tx.$executeRawUnsafe('ALTER TABLE "NewsletterSubscriber" ENABLE TRIGGER "NewsletterSubscriber_guard"'); });
  }
  try {
    smtp = await startSmtpFixture(); redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    const secret = randomBytes(32).toString("hex"), maintenance = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [admin, customer] = await Promise.all(["ADMIN", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@newsletter-smoke.example.invalid`, role, isVerified: true, password: hash } })));
    child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret, CHECKOUT_SWEEP_SECRET: maintenance, SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_USER: smtp.user, SMTP_PASS: smtp.password, SMTP_FROM: "Local newsletter <newsletter@example.invalid>", NODE_EXTRA_CA_CERTS: smtp.caPath });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signIngress({ secret, origin: child.origin, ip: `127.0.0.${sequence++}`, method, target }), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (actor) => { const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const moderator = await login(admin), buyer = await login(customer), path = "/api/newsletter", queue = "/api/admin/newsletter", workerPath = "/api/internal/newsletter/deliver", viewer = { "X-Newsletter-Owner": admin.id };
    phase = "actual compiled anonymous request and verified STARTTLS SMTP acceptance";
    const intent = { requestId: randomUUID(), email: `${randomUUID()}@recipient.example.invalid`, consent: true };
    const response = await send(path, "POST", intent); assert.equal(response.status, 202); const receipt = await response.json(); assert.equal(receipt.receipt.requestId, intent.requestId); assert.ok(!JSON.stringify(receipt).includes(intent.email)); assert.equal(smtp.messages.length, 1); assert.equal(smtp.messages[0].recipient, intent.email); assert.equal(smtp.counters().plaintextAuth, 0); assert.ok(smtp.counters().tlsSessions >= 1);
    let subscriber = await db.newsletterSubscriber.findUniqueOrThrow({ where: { email: intent.email } }); assert.equal(subscriber.status, "PENDING"); assert.equal((await db.newsletterRequest.findUniqueOrThrow({ where: { id: intent.requestId } })).state, "SENT");
    const confirmedLink = capability(smtp.messages[0], "confirm"), unsubscribeLink = capability(smtp.messages[0], "unsubscribe"); assert.equal(confirmedLink.url.origin, child.origin);
    phase = "exact retries, explicit action pages and token privacy";
    assert.equal((await send(path, "POST", intent)).status, 202); assert.equal(smtp.messages.length, 1);
    for (const route of ["/newsletter", "/newsletter/confirm", "/newsletter/unsubscribe"]) { const page = await send(route); assert.equal(page.status, 200); const html = await page.text(); assert.ok(!html.includes(confirmedLink.token)); assert.ok(/noindex/.test(html)); }
    const homepage = await send("/"); assert.equal(homepage.status, 200); const homeHtml = await homepage.text(); assert.ok(homeHtml.includes('name="newsletterEmail"')); assert.ok(homeHtml.includes("Product news and offers")); assert.ok(!homeHtml.includes("$20 coupon for first shopping"));
    assert.equal((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: subscriber.id } })).status, "PENDING"); assert.equal((await send(`${path}/confirm`)).status, 405);
    assert.equal((await send(`${path}/confirm`, "POST", { token: confirmedLink.token })).status, 200); assert.equal((await send(`${path}/confirm`, "POST", { token: confirmedLink.token })).status, 200); assert.equal((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: subscriber.id } })).status, "ACTIVE");
    phase = "active preference management, withdrawal and fresh generation";
    await elapsed(subscriber.id); const manage = { ...intent, requestId: randomUUID() }; assert.equal((await send(path, "POST", manage)).status, 202); const managementMail = smtp.messages.at(-1); assert.ok(!mailBody(managementMail.raw).includes("/newsletter/confirm")); assert.ok(mailBody(managementMail.raw).includes("does not change your preference"));
    assert.equal((await send(`${path}/unsubscribe`, "POST", { token: capability(managementMail, "unsubscribe").token })).status, 200); await elapsed(subscriber.id);
    const renewed = { ...intent, requestId: randomUUID() }; assert.equal((await send(path, "POST", renewed)).status, 202); subscriber = await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: subscriber.id } }); assert.equal(subscriber.generation, 2); assert.equal(subscriber.status, "PENDING");
    assert.equal((await send(`${path}/confirm`, "POST", { token: confirmedLink.token })).status, 400); const fresh = capability(smtp.messages.at(-1), "confirm"); assert.equal((await send(`${path}/confirm`, "POST", { token: fresh.token })).status, 200); assert.equal((await send(`${path}/unsubscribe`, "POST", { token: unsubscribeLink.token })).status, 200);
    phase = "actual provider rejection leaves consent pending and durable retry";
    smtp.rejectRecipients(true); const failedIntent = { requestId: randomUUID(), email: `${randomUUID()}@recipient.example.invalid`, consent: true }; const failed = await send(path, "POST", failedIntent); assert.equal(failed.status, 503); assert.equal((await failed.json()).code, "NEWSLETTER_DELIVERY_UNAVAILABLE"); assert.equal((await db.newsletterSubscriber.findUniqueOrThrow({ where: { email: failedIntent.email } })).status, "PENDING"); assert.equal((await db.newsletterRequest.findUniqueOrThrow({ where: { id: failedIntent.requestId } })).state, "FAILED");
    smtp.rejectRecipients(false); await db.newsletterRequest.update({ where: { id: failedIntent.requestId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    phase = "packaged supervised worker and dual maintenance authentication";
    assert.equal((await send(workerPath, "POST", undefined, undefined, { authorization: "Bearer wrong" })).status, 401); const unsigned = await requestHttp(child.origin + workerPath, { method: "POST", headers: { authorization: `Bearer ${maintenance}` } }); assert.equal(unsigned.status, 403);
    worker = spawn(process.execPath, [resolve(".next/standalone/scripts/newsletter-delivery-worker.mjs")], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), CHECKOUT_SWEEP_ORIGIN: child.origin, APP_URL: child.origin, CHECKOUT_SWEEP_SECRET: maintenance, TRUSTED_PROXY_SECRET: secret } });
    let counterBuffer = "";
    worker.on("error", () => undefined); worker.stdout.on("data", (chunk) => {
      counterBuffer += chunk.toString(); let end;
      while ((end = counterBuffer.indexOf("\n")) >= 0) { const line = counterBuffer.slice(0, end); counterBuffer = counterBuffer.slice(end + 1); try { const value = JSON.parse(line); if (value.event === "newsletter_delivery" && value.delivered === 1) workerConfirmed = true; } catch { /* Unconfirmed output is not published. */ } }
      if (counterBuffer.length > 8192) counterBuffer = "";
    }); worker.stderr.on("data", () => undefined);
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) { const saved = await db.newsletterRequest.findUniqueOrThrow({ where: { id: failedIntent.requestId } }); if (saved.state === "SENT" && workerConfirmed) break; if (worker.exitCode !== null) throw Error("Newsletter worker exited early"); await delay(100); }
    assert.equal((await db.newsletterRequest.findUniqueOrThrow({ where: { id: failedIntent.requestId } })).state, "SENT"); assert.equal(workerConfirmed, true); await stopWorker(); assert.equal(smtp.messages.at(-1).recipient, failedIntent.email); assert.equal((await db.newsletterSubscriber.findUniqueOrThrow({ where: { email: failedIntent.email } })).status, "PENDING");
    phase = "private administrator consent/delivery pages and revoked roles";
    assert.equal((await send(queue)).status, 403); assert.equal((await send(queue, "GET", undefined, buyer, { "X-Newsletter-Owner": customer.id })).status, 403); const records = await send(queue, "GET", undefined, moderator, viewer); assert.equal(records.status, 200); const data = await records.json(); assert.equal(data.total, 2); assert.equal(data.counts.PENDING, 1); assert.equal(data.counts.UNSUBSCRIBED, 1); for (const field of ["confirmationNonce", "unsubscribeNonce", "contentHash", "leaseToken"]) assert.ok(!JSON.stringify(data).includes(field));
    assert.equal((await send(`${queue}?mode=DELIVERIES`, "GET", undefined, moderator, viewer)).status, 200); const adminPage = await send("/admin/newsletter", "GET", undefined, moderator); assert.equal(adminPage.status, 200); assert.ok((await adminPage.text()).includes("Newsletter consent and delivery"));
    await db.user.update({ where: { id: admin.id }, data: { role: "USER" } }); assert.equal((await send(queue, "GET", undefined, moderator, viewer)).status, 403); const demoted = await login(admin); assert.equal((await send(queue, "GET", undefined, demoted, viewer)).status, 403);
    assert.equal(child.logContains(confirmedLink.token), false); assert.equal(child.logContains(intent.email), false); assert.equal(child.logContains("Controlled recipient rejection"), false); assert.equal(smtp.counters().plaintextAuth, 0);
    return { fresh35MigrationDatabase: "PASS", actualStarttlsSmtpTransport: "PASS", explicitDoubleOptInAndPrivateLinks: "PASS", exactRetryAndManagementMail: "PASS", withdrawalAndFreshConfirmation: "PASS", actualProviderRejectionAndRetainedConsent: "PASS", packagedWorkerRecoveryAndDualAuthentication: "PASS", privateAdminScopesAndRevocation: "PASS" };
  } finally { await stopWorker(); await child?.stop(); await redis?.close(); await smtp?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Newsletter smoke failed during ${phase}${detail}; capabilities, private messages, credentials and child output were not published.`); process.exitCode = 1; });
