import { test as base, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { tsImport } from "tsx/esm/api";
import { createFinancialSmokeDatabase } from "../../scripts/testing/finance-database.mjs";
import { startRedisRestFixture } from "../../scripts/testing/redis-rest-fixture.mjs";
import { startStandaloneFixture } from "../../scripts/testing/standalone-fixture.mjs";
import { startHttpsIngressFixture } from "../../scripts/testing/https-ingress-fixture.mjs";
import { BROWSER_READS_KEY, captureBrowserRead, installBrowserReadCapture, sameOriginWebKitDiagnostic } from "../../scripts/testing/browser-network-recovery.mjs";

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
    await context.addInitScript(installBrowserReadCapture, { key: BROWSER_READS_KEY });
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
    const unexpected = [], networkDiagnostics = new Set(), reads = new Map();
    const observeRead = (request) => {
      const read = captureBrowserRead(request, shop.origin);
      if (read) reads.set(read.url, read);
    };
    const observeError = (error) => {
      const target = sameOriginWebKitDiagnostic(error, shop.origin);
      if (target) networkDiagnostics.add(target);
      else unexpected.push({ name: error.name, message: error.message.replace(/\?[^\s"'<>)]*/g, "?[redacted]") });
    };
    page.on("request", observeRead); page.on("pageerror", observeError);
    try {
      await provide();
      page.off("request", observeRead);
      // WebKit may abort before the protocol emits request. The pre-dispatch
      // observer survives document replacement; validate its snapshots through
      // the exact same safe-read policy before considering them for replay.
      const snapshots = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "[]"), BROWSER_READS_KEY);
      expect(Array.isArray(snapshots), "Browser read metadata must remain valid").toBe(true);
      for (const snapshot of snapshots) {
        const read = captureBrowserRead({ url: () => snapshot.url, method: () => snapshot.method, headers: () => snapshot.headers, postData: () => snapshot.body }, shop.origin);
        if (read && !reads.has(read.url)) reads.set(read.url, read);
      }
      // Keep observing errors during recovery too. A native failure, arbitrary
      // mutation, foreign URL or uncaptured read must never be waived.
      for (const url of networkDiagnostics) {
        expect(networkDiagnostics.size, "Network recovery must remain bounded").toBeLessThanOrEqual(128);
        const original = reads.get(url);
        expect(original, "Network diagnostics require a captured safe read with its original method/body").toBeTruthy();
        const status = await page.evaluate(async (read) => {
          const { url: target, ...init } = read;
          try { return (await fetch(target, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) })).status; }
          catch { return 0; }
        }, original);
        expect(status, "A WebKit same-origin network diagnostic must have verified browser recovery").toBe(200);
      }
      expect(unexpected, "Critical browser flows must not leave uncaught JavaScript errors").toEqual([]);
    } finally { page.off("request", observeRead); page.off("pageerror", observeError); }
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
