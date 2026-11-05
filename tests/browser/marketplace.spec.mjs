import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { test, expect, login, addToCart, shipping } from "./fixtures.mjs";

test("login waits for hydration and preserves the first credential input", async ({ page, shop }) => {
  let release;
  const gate = new Promise((done) => { release = done; });
  let blocked = 0;
  await page.route((url) => url.origin === shop.origin && url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js"), async (route) => {
    blocked++;
    await gate;
    await route.continue();
  });
  try {
    await page.goto(shop.origin + "/login", { waitUntil: "commit" });
    await expect.poll(() => blocked).toBeGreaterThan(0);
    await expect(page.getByLabel("Email Address")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Sign In to Account" })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByLabel("Email Address")).toBeEnabled();
  await page.getByLabel("Email Address").fill(shop.accounts.customer.email);
  await page.getByLabel("Password", { exact: true }).fill(shop.password);
  await expect(page.getByLabel("Email Address")).toHaveValue(shop.accounts.customer.email);
  await page.getByRole("button", { name: "Sign In to Account" }).click();
  await expect(page).toHaveURL(/\/user\/dashboard$/);
});

test("guest catalog, cart and critical public navigation", async ({ page, shop }) => {
  await page.goto(shop.origin + "/products");
  await page.getByRole("link", { name: shop.product.name, exact: true }).first().click();
  await expect(page).toHaveURL(shop.origin + "/products/" + shop.product.slug);
  await addToCart(page, shop);
  await page.reload();
  await expect(page.getByText(shop.product.name, { exact: true }).first()).toBeVisible();
  for (const [path, heading] of [["/categories", /Shop by Category/], ["/brands", /Browse Brands/], ["/compare", /Compare products/], ["/wishlist", /wishlist/i], ["/contact", /Contact & Support/]]) {
    const response = await page.goto(shop.origin + path);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  }
});

test("customer coupon quote and COD checkout persist the reviewed server total", async ({ page, shop }) => {
  await login(page, shop);
  await addToCart(page, shop);
  await page.getByPlaceholder("Enter coupon code").fill(shop.coupon.code);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Coupon BROWSER10 applied/)).toBeVisible();
  await page.getByRole("button", { name: "Proceed to Checkout" }).click();
  await shipping(page);
  await page.getByRole("button", { name: "Confirm & Place Order" }).click();
  await expect(page).toHaveURL(/\/order-success\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: /Order received/ })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  const order = await shop.db.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  expect(order.userId).toBe(shop.accounts.customer.id);
  expect(order.paymentMethod).toBe("COD");
  expect(order.paymentStatus).toBe("UNPAID");
  expect(Number(order.total)).toBe(870);
  expect(order.items).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Order received/ })).toBeVisible();
});

test("a competing browser cart write is recoverable without an uncaught lock rejection", async ({ page, shop }) => {
  await addToCart(page, shop);
  const increase = page.getByRole("button", { name: `Increase ${shop.product.name} quantity` });
  await expect(increase).toBeEnabled();
  await page.evaluate(() => {
    window.__auditLockResult = navigator.locks.request("amar-gadget-guest-cart-v3", () => new Promise((release) => {
      window.__auditReleaseLock = release;
      window.__auditLockHeld = true;
    }));
  });
  try {
    await expect.poll(() => page.evaluate(() => window.__auditLockHeld)).toBe(true);
    await increase.click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.filter((lock) => lock.name === "amar-gadget-guest-cart-v3").length)).toBeGreaterThan(0);
    // Simulate another holder's committed revision after the UI captured its
    // expected snapshot. Keep the actual item/line identity and quantity intact.
    await page.evaluate(() => {
      const key = "amar-gadget-cart-guest-v3", cart = JSON.parse(localStorage.getItem(key));
      cart.revision++;
      localStorage.setItem(key, JSON.stringify(cart));
    });
  } finally {
    await page.evaluate(async () => { window.__auditReleaseLock?.(); await window.__auditLockResult; });
  }
  await expect(page.getByText("Guest cart changed in another tab. Refresh before changing it.", { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("amar-gadget-cart-guest-v3")).lines[0].quantity)).toBe(1);
  await page.getByRole("button", { name: "Refresh cart", exact: true }).click();
  await expect(increase).toBeEnabled();
  await increase.click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("amar-gadget-cart-guest-v3")).lines[0].quantity)).toBe(2);
  await page.reload();
  await expect(page.getByRole("button", { name: "Proceed to Checkout" })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("amar-gadget-cart-guest-v3")).lines[0].quantity)).toBe(2);
});

test("card reservation cancellation restores stock once and retains the guest cart", async ({ page, shop }) => {
  const stock = (await shop.db.product.findUniqueOrThrow({ where: { id: shop.product.id } })).stock;
  await addToCart(page, shop);
  await page.getByRole("button", { name: "Proceed to Checkout" }).click();
  await shipping(page);
  await page.getByRole("radio", { name: /Credit \/ Debit Card/ }).check();
  await page.getByRole("button", { name: "Review Order & Continue to Payment" }).click();
  await expect(page).toHaveURL(/\/checkout\?resume=[a-f0-9-]+$/);
  const id = new URL(page.url()).searchParams.get("resume");
  await expect(page.getByRole("button", { name: "Cancel reserved checkout" })).toBeVisible();
  expect((await shop.db.product.findUniqueOrThrow({ where: { id: shop.product.id } })).stock).toBe(stock - 1);
  await page.getByRole("button", { name: "Cancel reserved checkout" }).click();
  await expect(page.getByRole("heading", { name: "Checkout closed" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Checkout closed" })).toBeVisible();
  const order = await shop.db.order.findUniqueOrThrow({ where: { id } });
  expect(order.status).toBe("CANCELLED");
  expect(order.paymentStatus).toBe("FAILED");
  expect((await shop.db.product.findUniqueOrThrow({ where: { id: shop.product.id } })).stock).toBe(stock);
  await page.getByRole("link", { name: "View cart", exact: true }).click();
  await expect(page.getByText(shop.product.name, { exact: true }).first()).toBeVisible();
});

test("customer navigation cannot enter admin or seller workspaces", async ({ page, shop }) => {
  await login(page, shop);
  for (const path of ["/admin", "/member/add-product"]) {
    await page.goto(shop.origin + path);
    await expect(page).toHaveURL(shop.origin + "/unauthorized");
  }
});

test("seller uploads actual bytes, recovers storage failure and submits a private pending product", async ({ page, shop }) => {
  await login(page, shop, "seller");
  await page.goto(shop.origin + "/member/add-product");
  const name = "Browser upload " + randomUUID();
  await page.getByLabel("Product Title / Name", { exact: false }).fill(name);
  await page.getByLabel("Price (BDT) *", { exact: true }).fill("500");
  await page.getByLabel(/Stock Quantity/).fill("4");
  await page.getByLabel("Category *", { exact: true }).selectOption(shop.category.id);
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "blue" } }).png().toBuffer();
  shop.storage.setAvailable(false);
  try {
    await page.getByLabel("Add product images").setInputFiles({ name: "verified.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("button", { name: "Retry verified.png" })).toBeVisible();
  } finally { shop.storage.setAvailable(true); }
  await page.getByRole("button", { name: "Retry verified.png" }).click();
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit Product For Admin Approval" }).click();
  await expect.poll(() => shop.db.product.count({ where: { name, sellerId: shop.accounts.seller.id } })).toBe(1);
  const product = await shop.db.product.findFirstOrThrow({ where: { name } });
  expect(product.status).toBe("PENDING_APPROVAL");
  expect(product.images).toHaveLength(1);
  expect(shop.storage.objects.size).toBeGreaterThan(0);
  await page.goto(shop.origin + "/products/" + product.slug);
  // A streamed Next notFound response may be HTTP 200; assert the rendered
  // boundary, noindex and the non-streamed public API's independent denial.
  await expect(page.getByText("Not Found", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toHaveAttribute("content", /noindex/);
  expect(await page.evaluate(async (slug) => (await fetch(`/api/products/${slug}`)).status, product.slug)).toBe(404);
});

test("administrator authenticates into the real operations UI", async ({ page, shop }) => {
  await login(page, shop, "admin");
  await page.goto(shop.origin + "/admin/orders");
  await expect(page.getByRole("heading", { name: /orders/i }).first()).toBeVisible();
  await page.goto(shop.origin + "/admin/products");
  await expect(page.getByText(shop.product.name, { exact: true }).first()).toBeVisible();
});
