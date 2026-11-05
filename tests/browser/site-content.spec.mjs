import { randomUUID } from "node:crypto";
import { test, expect, login } from "./fixtures.mjs";

async function openDraft(page, shop, slug) {
  await login(page, shop, "admin");
  await page.goto(shop.origin + `/admin/settings/content/edit?kind=ARTICLE&slug=${slug}`);
  await expect(page.getByRole("button", { name: "Save private draft" })).toBeEnabled();
  await page.getByLabel("Title", { exact: true }).fill(`Reviewed browser article ${slug}`);
  await page.getByLabel("Summary", { exact: true }).fill("Actual local browser publication supplied by an authenticated administrator.");
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Heading", { exact: true }).fill("Reviewed publication information");
  await page.getByLabel("Body", { exact: true }).fill("<script>window.contentScriptExecuted = true</script>\nThis document remains plain text.");
  await page.getByLabel("Reason for this decision").fill("Save the actual isolated browser draft");
}

async function expectUnpublished(page, shop, slug, privateTitle) {
  const response = await page.request.get(shop.origin + `/blog/${slug}`), html = await response.text();
  // A parent loading boundary can already have streamed a 200 before the
  // awaited notFound interrupt. Require the real missing UI and noindex in
  // either protocol case, as documented by the installed Next version.
  expect([200, 404]).toContain(response.status());
  expect(html).toContain("Page not found");
  expect(html).toMatch(/name="robots"[^>]*content="[^"]*noindex/);
  expect(html).not.toContain(privateTitle);
}

test("administrator draft, reviewed publication and withdrawal reach the actual public article", async ({ page, shop }) => {
  const slug = `browser-content-${randomUUID()}`;
  await openDraft(page, shop, slug);
  await expect(page.getByRole("button", { name: "Publish reviewed saved draft" })).toBeDisabled();
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByText(/Original draft decision confirmed at revision 1/)).toBeVisible();
  const draft = await shop.db.siteContent.findUniqueOrThrow({ where: { kind_slug: { kind: "ARTICLE", slug } } });
  expect(draft.publishedVersion).toBeNull();
  await expectUnpublished(page, shop, slug, draft.draft.title);
  await page.getByLabel(/I reviewed this exact saved draft/).check();
  await page.getByLabel("Reason for this decision").fill("Publish the reviewed browser article");
  await page.getByRole("button", { name: "Publish reviewed saved draft" }).click();
  await expect(page.getByText(/Original publish decision confirmed at revision 2/)).toBeVisible();
  await page.goto(shop.origin + `/blog/${slug}`);
  await expect(page.getByRole("heading", { name: `Reviewed browser article ${slug}` })).toBeVisible();
  await expect(page.getByText("<script>window.contentScriptExecuted = true</script>", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.contentScriptExecuted)).toBeUndefined();
  await page.goto(shop.origin + `/admin/settings/content/edit?kind=ARTICLE&slug=${slug}`);
  await expect(page.getByRole("button", { name: "Unpublish document" })).toBeEnabled();
  await page.getByLabel("Reason for this decision").fill("Withdraw the isolated browser article");
  await page.getByRole("button", { name: "Unpublish document" }).click();
  await expect(page.getByText(/Original unpublish decision confirmed at revision 3/)).toBeVisible();
  await expectUnpublished(page, shop, slug, draft.draft.title);
  expect(await shop.db.siteContentRevision.count({ where: { kind: "ARTICLE", slug } })).toBe(3);
});

test("an applied draft with an unreadable response recovers its exact receipt after reload", async ({ page, shop }) => {
  const slug = `browser-receipt-${randomUUID()}`, decisions = [];
  let loseResponse = true;
  await page.route("**/api/admin/site-content", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    decisions.push(route.request().postDataJSON());
    if (!loseResponse) return route.continue();
    loseResponse = false;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    // The actual server committed. Only the synthetic test transport response
    // is replaced, leaving the application's uncertainty/retry path intact.
    await route.fulfill({ status: 503, contentType: "text/plain", body: "Local fixture interrupted the response" });
  });
  await openDraft(page, shop, slug);
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The content response could not be confirmed" })).toBeVisible();
  expect(await shop.db.siteContentRevision.count({ where: { kind: "ARTICLE", slug } })).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Retry original content decision" }).click();
  await expect(page.getByText(/Original draft decision confirmed at revision 1/)).toBeVisible();
  expect(decisions).toHaveLength(2); expect(decisions[1]).toEqual(decisions[0]);
  expect(await shop.db.siteContentRevision.count({ where: { kind: "ARTICLE", slug } })).toBe(1);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(`Reviewed browser article ${slug}`);
  const pending = await page.evaluate(({ ownerId, articleSlug }) => sessionStorage.getItem(`amar:site-content:${ownerId}:ARTICLE:${articleSlug}`), { ownerId: shop.accounts.admin.id, articleSlug: slug });
  expect(pending).toBeNull();
});
