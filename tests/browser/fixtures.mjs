import { test as base, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { tsImport } from "tsx/esm/api";
import { createFinancialSmokeDatabase } from "../../scripts/testing/finance-database.mjs";
import { startRedisRestFixture } from "../../scripts/testing/redis-rest-fixture.mjs";
import { startStandaloneFixture } from "../../scripts/testing/standalone-fixture.mjs";
import { startHttpsIngressFixture } from "../../scripts/testing/https-ingress-fixture.mjs";

export const test = base.extend({
  shop: [async ({}, provide) => {
    const database = await createFinancialSmokeDatabase();
    let redis, storage, server, ingressServer;
    try {
      const { hashPassword } = await tsImport("../../lib/password.ts", import.meta.url);
      const { startS3MediaFixture } = await tsImport("../helpers/s3-media-fixture.ts", import.meta.url);
      storage = await startS3MediaFixture();
      const password = randomBytes(24).toString("hex"), hash = await hashPassword(password), ingress = randomBytes(32).toString("hex");
      const accounts = {};
      for (const [name, role] of [["customer", "USER"], ["seller", "MEMBER"], ["admin", "ADMIN"]]) {
        accounts[name] = await database.db.user.create({ data: { name: `Browser ${name}`, email: `${name}-${randomUUID()}@browser.example.invalid`, password: hash, role, sellerStatus: "APPROVED", isVerified: true } });
      }
      const category = await database.db.category.create({ data: { name: "Browser verified gadgets", slug: randomUUID() } });
      const product = await database.db.product.create({ data: { name: "Browser verified headphones", slug: randomUUID(), price: 1000, discountPrice: 800, stock: 100, categoryId: category.id, sellerId: accounts.seller.id, status: "APPROVED", description: "Isolated browser catalog product." } });
      const coupon = await database.db.coupon.create({ data: { code: "BROWSER10", discount: 10, isPercentage: true, isActive: true, minSpend: 0 } });
      redis = await startRedisRestFixture(randomBytes(32).toString("hex"));
      ingressServer = await startHttpsIngressFixture();
      server = await startStandaloneFixture(database.url, redis, {
        APP_URL: ingressServer.origin,
        TRUSTED_PROXY_SECRET: ingress,
        R2_BUCKET_NAME: "fixture-media", R2_ACCESS_KEY_ID: storage.credentials.accessKeyId,
        R2_SECRET_ACCESS_KEY: storage.credentials.secretAccessKey, R2_PUBLIC_URL: "https://cdn.media.example.invalid",
        AUDIT_AVATAR_S3_FIXTURE: storage.endpoint,
        NODE_OPTIONS: `--require="${resolve("scripts/testing/avatar-s3-preload.cjs").replaceAll("\\", "/")}"`,
      });
      ingressServer.attach(server.origin, ingress, storage.endpoint);
      await provide({ db: database.db, accounts, category, product, coupon, password, storage, origin: ingressServer.origin });
    } finally { await ingressServer?.close(); await server?.stop(); await storage?.close(); await redis?.close(); await database.close(); }
  }, { scope: "worker", timeout: 90_000 }],
  context: async ({ context, shop }, provide) => {
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === shop.origin) {
        await route.continue();
      } else if ([`fixture-media.${"a".repeat(32)}.r2.cloudflarestorage.com`, "cdn.media.example.invalid"].includes(url.hostname)) {
        // Browser bytes reach the real local SigV4 verifier. Only transport is
        // redirected; application presigning, receipts and decoding stay real.
        const prefix = url.hostname === "cdn.media.example.invalid" ? "/__fixture_media" : "/__fixture_storage";
        await route.continue({ url: shop.origin + prefix + url.pathname + url.search });
      } else { await route.abort("blockedbyclient"); }
    });
    await provide(context);
  },
  uncaughtErrors: [async ({ page, shop }, provide) => {
    const failures = [];
    page.on("pageerror", (error) => failures.push(error));
    await provide();
    const unexpected = [], networkDiagnostics = new Set();
    for (const error of failures) {
      // WebKit emits this network diagnostic as pageerror during document
      // replacement, sometimes before a requestfailed event exists. Do not
      // discard it: require an actual successful browser fetch to the exact
      // same-origin URL below. JavaScript errors and external CORS errors fail.
      const match = error.name === "Fetch API cannot load https" ? error.message.match(/^\/{1,2}(127\.0\.0\.1:\d+\/\S+) due to access control checks\.$/) : null;
      const target = match ? `https://${match[1]}` : null;
      if (target && new URL(target).origin === shop.origin) networkDiagnostics.add(target);
      else unexpected.push(error.name);
    }
    for (const url of networkDiagnostics) {
      const status = await page.evaluate(async (target) => {
        try { return (await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(5000) })).status; }
        catch { return 0; }
      }, url);
      expect(status, "A WebKit same-origin network diagnostic must have verified browser recovery").toBe(200);
    }
    expect(unexpected, "Critical browser flows must not leave uncaught JavaScript errors").toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function login(page, shop, account = "customer") {
  await page.goto(shop.origin + "/login");
  await page.getByLabel("Email Address").fill(shop.accounts[account].email);
  await page.getByLabel("Password", { exact: true }).fill(shop.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(new RegExp(account === "admin" ? "/admin/?$" : account === "seller" ? "/member/dashboard$" : "/user/dashboard$"));
}

export async function addToCart(page, shop) {
  await page.goto(shop.origin + "/products/" + shop.product.slug);
  await expect(page.getByRole("heading", { name: shop.product.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: /add to cart/i }).click();
  await expect(page.getByText(/Added 1 item\(s\) to your shopping cart/)).toBeVisible();
  await page.goto(shop.origin + "/cart");
  await expect(page.getByText(shop.product.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Proceed to Checkout" })).toBeEnabled();
}

export async function shipping(page) {
  await page.getByLabel("Full Name", { exact: false }).fill("Isolated Browser Buyer");
  await page.getByLabel("Phone Number", { exact: false }).fill("01700000000");
  await page.getByLabel("Street Address", { exact: false }).fill("Local test building, Road 4");
  await page.getByLabel("City", { exact: false }).fill("Dhaka");
  await page.getByLabel("District / Division", { exact: false }).fill("Dhaka");
}
