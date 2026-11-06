import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";
let phase = "fresh isolated support database";
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db; let child, redis, sequence = 1;
  try {
    const secret = randomBytes(32).toString("hex"), password = randomBytes(32).toString("hex"), { hashPassword } = await tsImport("../lib/password.ts", import.meta.url), hash = await hashPassword(password);
    const [admin, customer] = await Promise.all(["ADMIN", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@support-smoke.example.invalid`, role, isVerified: true, password: hash } })));
    redis = await startRedisRestFixture(randomBytes(32).toString("hex")); child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, { method, headers: { ...signIngress({ secret, origin: child.origin, ip: `127.0.0.${sequence++}`, method, target }), ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (actor) => { const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
    const moderator = await login(admin), buyer = await login(customer), path = "/api/contact", queue = "/api/admin/support", viewer = { "X-Support-Owner": admin.id };
    const input = { requestId: randomUUID(), name: "Local support sender", email: `${randomUUID()}@sender.example.invalid`, topic: "ORDER", subject: "Actual compiled support inquiry", orderReference: "Unverified sender reference", message: "Please review my shipment inquiry.\nThis is a real stored local fixture.", consent: true };
    phase = "signed anonymous persisted submission and exact retry";
    const unsigned = await requestHttp(child.origin + path, { method: "POST", headers: { Origin: child.origin, "Content-Type": "application/json" }, body: JSON.stringify(input) }); assert.equal(unsigned.status, 403);
    const submitted = await send(path, "POST", input); assert.equal(submitted.status, 201); assert.equal(submitted.headers.get("cache-control"), "private, no-store"); const receipt = (await submitted.json()).receipt;
    const retry = await send(path, "POST", input); assert.equal(retry.status, 201); assert.deepEqual((await retry.json()).receipt, receipt); assert.deepEqual(Object.keys(receipt).sort(), ["id", "receivedAt"]); assert.equal(await db.supportMessage.count(), 1);
    assert.equal((await send(path, "POST", { ...input, message: "Conflicting content cannot overwrite this message" })).status, 409);
    assert.equal((await send(path, "POST", { ...input, requestId: randomUUID(), email: `${randomUUID()}@sender.example.invalid`, consent: false })).status, 400);
    phase = "private current administrator reads and bounded filtering";
    assert.equal((await send(queue)).status, 403); assert.equal((await send(queue, "GET", undefined, buyer, { "X-Support-Owner": customer.id })).status, 403); assert.equal((await send(queue, "GET", undefined, moderator, { "X-Support-Owner": customer.id })).status, 409);
    const listed = await send(queue, "GET", undefined, moderator, viewer); assert.equal(listed.status, 200); const first = await listed.json(); assert.equal(first.total, 1); assert.equal(first.counts.OPEN, 1); assert.ok(!JSON.stringify(first).includes(input.email));
    const detail = await send(`${queue}?id=${receipt.id}`, "GET", undefined, moderator, viewer); assert.equal(detail.status, 200); const original = await detail.json(); assert.equal(original.message.message, input.message); assert.equal(original.message.email, input.email); assert.ok(!Object.hasOwn(original.message, "contentHash"));
    phase = "audited internal status exact receipts and stale protection";
    const decision = { requestId: randomUUID(), id: receipt.id, version: 1, status: "IN_PROGRESS", reason: "Reviewing the original local shipment record" };
    const changed = await send(queue, "POST", decision, moderator, viewer); assert.equal(changed.status, 200); const saved = await changed.json();
    const duplicate = await send(queue, "POST", decision, moderator, viewer); assert.equal(duplicate.status, 200); assert.deepEqual(await duplicate.json(), saved); assert.equal(await db.supportMessageEvent.count(), 1);
    assert.equal((await send(queue, "POST", { ...decision, requestId: randomUUID(), status: "RESOLVED" }, moderator, viewer)).status, 409);
    const reopened = { ...decision, requestId: randomUUID(), version: 2, status: "OPEN", reason: "Further review requested by the local sender" }; assert.equal((await send(queue, "POST", reopened, moderator, viewer)).status, 200);
    const history = await (await send(`${queue}?id=${receipt.id}`, "GET", undefined, moderator, viewer)).json(); assert.equal(history.history.total, 2); assert.equal(history.message.version, 3); assert.equal(history.message.message, input.message);
    phase = "compiled pages and removal of unverified sample claims";
    const publicPage = await send("/contact"); assert.equal(publicPage.status, 200); const publicHtml = await publicPage.text(); assert.ok(publicHtml.includes("Contact &amp; Support")); assert.ok(!publicHtml.includes("Amar Gadget Tower")); assert.ok(!publicHtml.includes("24/7 Customer Support")); assert.ok(publicHtml.includes('name="message"'));
    const adminPage = await send("/admin/support", "GET", undefined, moderator); assert.equal(adminPage.status, 200); assert.ok((await adminPage.text()).includes("Support inquiries"));
    phase = "dashboard-managed draft and published support contacts on actual pages";
    const settingsPath = `${queue}/contact-settings`, contactFields = { email: "native-support@example.invalid", phone: "+880 1700 123456", address: "Native local support office", hours: "Sunday to Thursday, 10:00-18:00 Asia/Dhaka", published: false };
    assert.equal((await send(settingsPath, "GET", undefined, buyer, { "X-Support-Owner": customer.id })).status, 403);
    const initialSettings = await send(settingsPath, "GET", undefined, moderator, viewer); assert.equal(initialSettings.status, 200); assert.equal((await initialSettings.json()).settings, null);
    const draft = { requestId: randomUUID(), version: 0, fields: contactFields, verified: false, reason: "Preparing actual local public contact fixture" };
    assert.equal((await send(settingsPath, "POST", draft, moderator, viewer)).status, 200);
    for (const route of ["/contact", "/"]) { const response = await send(route); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(contactFields.email)); }
    const publish = { ...draft, requestId: randomUUID(), version: 1, fields: { ...contactFields, published: true }, verified: true };
    const published = await send(settingsPath, "POST", publish, moderator, viewer); assert.equal(published.status, 200); const publishedReceipt = await published.json();
    const publishRetry = await send(settingsPath, "POST", publish, moderator, viewer); assert.equal(publishRetry.status, 200); assert.deepEqual(await publishRetry.json(), publishedReceipt);
    assert.equal((await send(settingsPath, "POST", { ...publish, requestId: randomUUID() }, moderator, viewer)).status, 409);
    for (const route of ["/contact", "/"]) { const response = await send(route); assert.equal(response.status, 200); const html = await response.text(); for (const value of [contactFields.email, contactFields.address, contactFields.hours]) assert.ok(html.includes(value)); assert.ok(!html.includes("17 Princess Road")); assert.ok(!html.includes("Call us 24/7")); }
    assert.equal((await send(settingsPath, "POST", { ...draft, requestId: randomUUID(), version: 2 }, moderator, viewer)).status, 200);
    for (const route of ["/contact", "/"]) assert.ok(!(await (await send(route)).text()).includes(contactFields.email));
    const settingsPage = await send("/admin/settings/support", "GET", undefined, moderator); assert.equal(settingsPage.status, 200); assert.ok((await settingsPage.text()).includes("Public support contact settings")); assert.equal(await db.supportContactEvent.count(), 3);
    phase = "actual PostgreSQL failure returns unavailable without a fake receipt";
    await db.$executeRawUnsafe("CREATE FUNCTION native_support_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated support persistence failure'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER native_support_failure BEFORE INSERT ON "SupportMessage" FOR EACH ROW EXECUTE FUNCTION native_support_failure()');
    const failedInput = { ...input, requestId: randomUUID(), email: `${randomUUID()}@sender.example.invalid` }, failed = await send(path, "POST", failedInput); assert.equal(failed.status, 503); assert.equal((await failed.json()).code, "SUPPORT_UNAVAILABLE"); assert.equal(await db.supportMessage.count({ where: { id: failedInput.requestId } }), 0);
    for (let attempt = 0; attempt < 20 && !child.logContains("Support operation unavailable;"); attempt++) await delay(25);
    assert.equal(child.logContains("Support operation unavailable;"), true); assert.equal(child.logContains("isolated support persistence failure"), false); assert.equal(child.logContains(failedInput.email), false); assert.equal(child.logContains(failedInput.message), false);
    phase = "revoked administrator cookie and current demoted role cannot read support";
    await db.user.update({ where: { id: admin.id }, data: { role: "USER" } }); assert.equal((await send(queue, "GET", undefined, moderator, viewer)).status, 403); const demoted = await login(admin); assert.equal((await send(queue, "GET", undefined, demoted, viewer)).status, 403);
    return { fresh34MigrationDatabase: "PASS", compiledAnonymousSubmissionAndExactRetry: "PASS", privateAdministratorScopes: "PASS", revisionHistoryAndRetryReceipt: "PASS", actualPersistenceFailure: "PASS", compiledContactAndSupportPages: "PASS", dynamicDraftPublicationAndUnpublish: "PASS", currentRoleRevocation: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => { const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : ""; console.error(`Support smoke failed during ${phase}${detail}; private payloads, credentials and child output were not published.`); process.exitCode = 1; });
