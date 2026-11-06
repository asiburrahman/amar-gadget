import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { tsImport } from "tsx/esm/api";
import { signIngress } from "../lib/ingress-protocol.cjs";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { startStandaloneFixture } from "./testing/standalone-fixture.mjs";
import { startRedisRestFixture } from "./testing/redis-rest-fixture.mjs";
import { requestHttp } from "./testing/http-request.mjs";

let phase = "disposable migration and account setup";
async function unpublished(response, privateTitle) {
  // Streaming from the parent loading boundary can commit a 200 before the
  // page's awaited notFound interrupt. Missing UI/noindex and no private body
  // are mandatory for both the pre-stream 404 and streamed 200 response.
  assert.ok([200, 404].includes(response.status));
  const html = await response.text();
  assert.ok(html.includes("Page not found")); assert.match(html, /name="robots"[^>]*content="[^"]*noindex/);
  assert.ok(!html.includes(privateTitle));
}
async function main() {
  const fixture = await createFinancialSmokeDatabase(), db = fixture.db;
  let child, redis, sequence = 1;
  try {
    assert.equal(await db.siteContent.count(), 0); assert.equal(await db.siteContentRevision.count(), 0);
    const { hashPassword } = await tsImport("../lib/password.ts", import.meta.url);
    const password = randomBytes(32).toString("hex"), hash = await hashPassword(password), secret = randomBytes(32).toString("hex");
    const [admin, customer] = await Promise.all(["ADMIN", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@content-smoke.example.invalid`, role, isVerified: true, password: hash } })));
    redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
    child = await startStandaloneFixture(fixture.url, redis, { TRUSTED_PROXY_SECRET: secret });
    const send = (target, method = "GET", body, cookie, extra = {}) => requestHttp(child.origin + target, {
      method, headers: { "User-Agent": "Twitterbot", ...signIngress({ secret, origin: child.origin, ip: `127.0.0.${sequence++}`, method, target }),
        ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: child.origin, "Content-Type": "application/json" } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const login = async (actor) => {
      const response = await send("/api/auth/login", "POST", { email: actor.email, password }); assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie;
    };
    const moderator = await login(admin), buyer = await login(customer), path = "/api/admin/site-content", viewer = { "X-Site-Content-Owner": admin.id };
    const address = { kind: "ARTICLE", slug: "compiled-reviewed-article" };
    const fields = { title: "Compiled reviewed marketplace article", summary: "Actual retained local publication written through the compiled administrator API.", byline: "Local fixture operator", sections: [{ heading: "Published information", body: "<script>window.contentExecuted=true</script>\nActual retained plain text." }] };
    const draft = { ...address, requestId: randomUUID(), version: 0, action: "DRAFT", reason: "Prepare actual local publication", fields };
    phase = "verified ingress, origin, owner and administrator boundaries";
    assert.equal((await requestHttp(child.origin + path, { method: "POST", headers: { Origin: child.origin, "Content-Type": "application/json", Cookie: moderator }, body: JSON.stringify(draft) })).status, 403);
    assert.equal((await send(path, "POST", draft, moderator, { ...viewer, Origin: "https://foreign.example.invalid" })).status, 403);
    assert.equal((await send(path, "POST", draft, buyer, { "X-Site-Content-Owner": customer.id })).status, 403);
    assert.equal((await send(path, "POST", draft, moderator, { "X-Site-Content-Owner": customer.id })).status, 409);
    phase = "private saved drafts, original receipts and complete publication review";
    const created = await send(path, "POST", draft, moderator, viewer); assert.equal(created.status, 200);
    assert.equal(created.headers.get("cache-control"), "private, no-store"); const receipt = await created.json();
    await unpublished(await send(`/blog/${address.slug}`), fields.title);
    const retry = await send(path, "POST", draft, moderator, viewer); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), receipt);
    const publication = { ...address, requestId: randomUUID(), version: 1, action: "PUBLISH", reason: "Publish the reviewed saved document", reviewed: true };
    assert.equal((await send(path, "POST", { ...publication, reviewed: false }, moderator, viewer)).status, 400);
    assert.equal((await send(path, "POST", { ...publication, fields }, moderator, viewer)).status, 400);
    assert.equal((await send(path, "POST", publication, moderator, viewer)).status, 200);
    const published = await send(`/blog/${address.slug}`); assert.equal(published.status, 200);
    const html = await published.text(); assert.ok(html.includes(fields.title)); assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>window.contentExecuted"));
    phase = "public article collection, truthful guides, administration and retained sitemap snapshots";
    const blog = await send("/blog"); assert.equal(blog.status, 200); assert.ok((await blog.text()).includes(`/blog/${address.slug}`));
    const about = await send("/about"); assert.equal(about.status, 200); const guide = await about.text(); assert.ok(guide.includes("No operator document is currently published")); assert.ok(!guide.includes("48,500"));
    phase = "dashboard-managed fixed pages and published homepage summary";
    for (const slug of ["about", "faq", "returns", "privacy-policy", "terms"]) {
      const page = { kind: "PAGE", slug }, content = { ...fields, title: `Compiled operator ${slug}`, summary: `Retained operator supplied summary for ${slug}.` };
      assert.equal((await send(path, "POST", { ...draft, ...page, requestId: randomUUID(), fields: content }, moderator, viewer)).status, 200);
      assert.equal((await send(path, "POST", { ...publication, ...page, requestId: randomUUID() }, moderator, viewer)).status, 200);
      const response = await send(`/${slug}`); assert.equal(response.status, 200);
      const rendered = await response.text(); assert.ok(rendered.includes(content.title)); assert.ok(rendered.includes(content.summary));
      assert.ok(!rendered.includes("No operator document is currently published"));
      if (slug === "faq") { assert.ok(rendered.includes('"@type":"FAQPage"')); assert.ok(!rendered.includes("<script>window.contentExecuted")); }
    }
    const home = await send("/"); assert.equal(home.status, 200);
    const homeHtml = await home.text(); assert.ok(homeHtml.includes("Retained operator supplied summary for about.")); assert.ok(!homeHtml.includes("Free Shipping on Orders $50+"));
    const privateAbout = { ...draft, kind: "PAGE", slug: "about", requestId: randomUUID(), version: 2, fields: { ...fields, summary: "Unpublished operator summary must stay private." } };
    assert.equal((await send(path, "POST", privateAbout, moderator, viewer)).status, 200);
    const unchangedHome = await (await send("/")).text(); assert.ok(unchangedHome.includes("Retained operator supplied summary for about.")); assert.ok(!unchangedHome.includes(privateAbout.fields.summary));
    for (const route of ["/admin/settings/content", "/admin/settings/content/edit?kind=ARTICLE&slug=compiled-reviewed-article"]) {
      const response = await send(route, "GET", undefined, moderator); assert.equal(response.status, 200); assert.ok((await response.text()).includes("article"));
    }
    const originalSitemap = await (await send("/sitemaps/articles-0.xml")).text(); assert.ok(originalSitemap.includes(`/blog/${address.slug}`));
    const privateDraft = { ...draft, requestId: randomUUID(), version: 2, fields: { ...fields, title: "Unpublished private replacement title" } };
    assert.equal((await send(path, "POST", privateDraft, moderator, viewer)).status, 200);
    const unchanged = await (await send(`/blog/${address.slug}`)).text(); assert.ok(unchanged.includes(fields.title)); assert.ok(!unchanged.includes(privateDraft.fields.title));
    assert.equal(await (await send("/sitemaps/articles-0.xml")).text(), originalSitemap);
    phase = "retained revision history, explicit withdrawal and legacy entry contracts";
    const history = await send(`${path}?kind=ARTICLE&slug=${address.slug}`, "GET", undefined, moderator, viewer);
    const saved = await history.json(); assert.equal(saved.history.total, 3); assert.equal(saved.document.version, 3);
    assert.equal((await send(path, "POST", { ...address, requestId: randomUUID(), version: 3, action: "UNPUBLISH", reason: "Withdraw the reviewed article for further review" }, moderator, viewer)).status, 200);
    await unpublished(await send(`/blog/${address.slug}`), fields.title); assert.equal(await db.siteContentRevision.count({ where: address }), 4);
    const legacy = await send("/order-success?paid=true"); assert.equal(legacy.status, 200); assert.ok((await legacy.text()).includes("It does not confirm that an order was placed or paid."));
    const email = await send("/verify-email?email=local%2Boperator%40example.invalid");
    const destination = "/verify-otp?email=local%2Boperator%40example.invalid";
    if (email.status === 307) assert.equal(email.headers.get("location"), destination);
    else {
      assert.equal(email.status, 200);
      const redirected = await email.text();
      assert.ok(redirected.includes('http-equiv="refresh"'));
      assert.ok(redirected.includes(`url=${destination}`));
      assert.ok(!redirected.includes("Email verified successfully"));
    }
    assert.equal((await send("/api/stripe/customer-portal", "POST", {}, buyer)).status, 410);
    phase = "real missing-relation failure and revoked administrator session";
    await db.$executeRawUnsafe('ALTER TABLE "SiteContent" RENAME TO "ContentSmokeUnavailable"');
    try {
      const unavailable = await send(`${path}?kind=PAGE&slug=about`, "GET", undefined, moderator, viewer); assert.equal(unavailable.status, 503);
      const failure = await unavailable.json(); assert.equal(failure.code, "SITE_CONTENT_UNAVAILABLE"); assert.ok(failure.reference); assert.ok(!JSON.stringify(failure).includes("ContentSmokeUnavailable"));
    } finally { await db.$executeRawUnsafe('ALTER TABLE "ContentSmokeUnavailable" RENAME TO "SiteContent"'); }
    await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal((await send(`${path}?kind=ARTICLE&slug=${address.slug}`, "GET", undefined, moderator, viewer)).status, 403);
    return { freshMigrationWithoutSampleContent: "PASS", compiledCurrentAuthorityAndIngress: "PASS", privateDraftAndExactReceipt: "PASS", reviewedPublicationAndWithdrawal: "PASS", actualArticleAndAdminPages: "PASS", allFixedPagesAndPublishedHomepageSummary: "PASS", retainedSitemapPublication: "PASS", legacyEntryContracts: "PASS", actualDatabaseFailureAndRevocation: "PASS" };
  } finally { await child?.stop(); await redis?.close(); await fixture.close(); }
}
main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  const detail = error?.code === "ERR_ASSERTION" && ["number", "boolean"].includes(typeof error.actual) ? ` (${error.actual} != ${error.expected})` : "";
  console.error(`Site content smoke failed during ${phase}${detail}; private payloads, credentials and child output were not published.`); process.exitCode = 1;
});
