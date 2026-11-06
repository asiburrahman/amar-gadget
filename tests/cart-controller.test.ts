import { randomUUID } from "node:crypto";
import { createCartController, type CartScope } from "@/lib/client/cart-controller";
import { GUEST_CART_KEY, LEGACY_CART_KEY } from "@/lib/client/guest-cart";
import type { AccountCartSnapshot, CartViewLine } from "@/lib/validations/cart";
import { getCheckoutAttempt, readCheckoutAttempt } from "@/lib/checkout-attempt";

const productId = randomUUID(), secondId = randomUUID();
const line = (id: string = productId, quantity = 1, stock = 10): CartViewLine => ({ id, lineId: randomUUID(), quantity, lineVersion: 1, product: { id, slug: "current-product", name: "Current product", price: 100, discountPrice: 80, stock, imageUrl: null, category: "Current category" } });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(predicate()).toBe(true);
};
function fixture(initialScope: CartScope = "guest") {
  let scope = initialScope, blocked = false, stock = 10, outage = false;
  const values = new Map<string, string>();
  const sessionValues = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (blocked) throw new Error("Quota"); values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let account: AccountCartSnapshot = { ownerId: "owner-a", version: 3, couponCode: null, couponVersion: 0, lines: [line()], pendingCheckouts: {} };
  const fetcher = jest.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (outage) return response({ success: false, message: "Catalog unavailable" }, 503);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === "/api/cart/guest") return response({ success: true, lines: body.lines.map((entry: { productId: string; lineId: string; quantity: number }) => ({ ...line(entry.productId, entry.quantity, stock), lineId: entry.lineId })) });
    if (url === "/api/cart") return response({ success: true, ...account });
    if (String(url).startsWith("/api/checkout/") && body?.action === "ack-cart") return response({ cartAcknowledged: true });
    throw new Error(`Unexpected test HTTP boundary ${url}`);
  });
  const notify = jest.fn(), accountChanged = jest.fn();
  const attemptStorage = { getItem: (key: string) => sessionValues.get(key) ?? null, setItem: (key: string, value: string) => { sessionValues.set(key, value); }, removeItem: (key: string) => { sessionValues.delete(key); } };
  const store = createCartController({ fetcher, storage: () => storage, scopeNow: () => scope, notify, accountChanged, attemptStorage: () => attemptStorage });
  const start = async () => { await store.getState().initialize(); store.getState().setScope(scope); await waitFor(() => store.getState().status !== "loading" && !store.getState().refreshing); };
  const changeScope = (value: CartScope) => { scope = value; store.getState().setScope(value); };
  return { store, fetcher, storage, values, attemptStorage, notify, accountChanged, start, changeScope, account: (value: Partial<AccountCartSnapshot>) => { account = { ...account, ...value }; }, block: (value: boolean) => { blocked = value; }, stock: (value: number) => { stock = value; }, outage: (value: boolean) => { outage = value; } };
}
describe("cart controller at the HTTP/browser storage boundary", () => {
  it("refreshes actual product metadata and stock instead of trusting an add button's cached data", async () => {
    const f = fixture(); await f.start();
    expect(await f.store.getState().addItem({ id: productId, name: "Spoofed cached title", price: 1, stock: 999, quantity: 2 })).toBe(true);
    expect(f.store.getState().items[0]).toMatchObject({ name: "Current product", price: 100, discountPrice: 80, stock: 10, quantity: 2, available: true });
    expect(f.values.get(GUEST_CART_KEY)).not.toContain("Spoofed"); expect(f.values.get(GUEST_CART_KEY)).not.toContain("price");
    f.stock(1); expect(await f.store.getState().updateQuantity(productId, 3)).toBe(false); expect(f.store.getState().items[0].quantity).toBe(2);
  });
  it("keeps persisted reductions/removals usable during a catalog outage and disables checkout", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 3 });
    f.outage(true); expect(await f.store.getState().refresh()).toBe(false);
    expect(await f.store.getState().updateQuantity(productId, 1)).toBe(true);
    expect(JSON.parse(f.values.get(GUEST_CART_KEY)!).lines[0].quantity).toBe(1);
    expect(() => f.store.getState().getCheckoutContext()).toThrow("Refresh");
    expect(await f.store.getState().removeItem(productId)).toBe(true); expect(JSON.parse(f.values.get(GUEST_CART_KEY)!).lines).toEqual([]);
  });
  it("retains tab-only changes on later refreshes and reports the storage limitation", async () => {
    const f = fixture(); await f.start(); f.block(true);
    expect(await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 2 })).toBe(true);
    await f.store.getState().refresh(); expect(f.store.getState().items[0].quantity).toBe(2); expect(f.store.getState().memoryOnly).toBe(true);
    expect(() => f.store.getState().getCheckoutContext()).toThrow("Enable browser storage");
    expect(f.store.getState().notice).toContain("tab only"); f.block(false);
    expect(await f.store.getState().retryStorage()).toBe(true); expect(f.store.getState().memoryOnly).toBe(false);
  });
  it("clears previous account data synchronously and rejects an obsolete account read", async () => {
    const f = fixture("account:owner-a"); await f.start(); expect(f.store.getState().items).toHaveLength(1);
    let release!: (value: Response) => void;
    f.fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const oldRead = f.store.getState().refresh();
    f.account({ ownerId: "owner-b", lines: [line(secondId, 2)], version: 10 }); f.changeScope("account:owner-b");
    expect(f.store.getState().items).toEqual([]); expect(f.store.getState().couponCode).toBeNull();
    await waitFor(() => f.store.getState().status === "ready");
    release(response({ success: true, ownerId: "owner-a", version: 4, couponCode: "PRIVATE-A", couponVersion: 1, lines: [line()], pendingCheckouts: {} }));
    await oldRead; expect(f.store.getState().items[0].id).toBe(secondId); expect(f.store.getState().couponCode).toBeNull();
    expect(f.values.get(GUEST_CART_KEY)).not.toContain("PRIVATE-A");
  });
  it("sends current owner/version/line identity and never persists an account snapshot in browser storage", async () => {
    const f = fixture("account:owner-a"); await f.start(); const id = f.store.getState().items[0].lineId;
    f.fetcher.mockImplementationOnce(async (_url, init) => {
      expect(init?.headers).toMatchObject({ "X-Cart-Owner": "owner-a" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ action: "set", version: 3, productId, lineId: id, quantity: 3, requestId: expect.any(String) });
      f.account({ version: 4, lines: [{ ...line(), lineId: id!, quantity: 3 }] });
      return response({ success: true, ownerId: "owner-a", acceptedIds: [productId], skippedIds: [], version: 4 });
    });
    expect(await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 2 })).toBe(true);
    expect(f.store.getState().items[0].quantity).toBe(3); expect(f.values.get(GUEST_CART_KEY)).not.toContain(productId);
    f.changeScope("guest"); await waitFor(() => f.store.getState().status === "ready"); expect(f.store.getState().items).toEqual([]);
  });
  it("rejects uncertain/stale account mutations, refreshes and does not silently replay an increment", async () => {
    const f = fixture("account:owner-a"); await f.start(); f.fetcher.mockClear();
    f.fetcher.mockImplementationOnce(async () => response({ success: false, code: "CART_CHANGED", message: "Changed in another session" }, 409));
    expect(await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 1 })).toBe(false);
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.store.getState().error).toContain("Changed in another session"); expect(f.store.getState().items[0].quantity).toBe(1);
  });
  it("committed account changes remain successful when the follow-up read fails", async () => {
    const f = fixture("account:owner-a"); await f.start();
    f.fetcher.mockImplementationOnce(async () => response({ success: true, ownerId: "owner-a", acceptedIds: [], skippedIds: [] }));
    f.fetcher.mockImplementationOnce(async () => response({ success: false, message: "Read unavailable" }, 503));
    expect(await f.store.getState().removeItem(productId)).toBe(true); expect(f.store.getState().notice).toContain("saved"); expect(f.store.getState().status).toBe("error");
  });
  it("refuses a queued request after its cookie identity changes and requests a fresh session", async () => {
    const f = fixture("account:owner-a"); await f.start();
    f.fetcher.mockImplementationOnce(async () => response({ success: false, code: "CART_ACCOUNT_CHANGED", message: "Account changed" }, 409));
    f.fetcher.mockImplementationOnce(async () => response({ success: false, code: "CART_ACCOUNT_CHANGED", message: "Account changed" }, 409));
    expect(await f.store.getState().updateQuantity(productId, 2)).toBe(false); expect(f.store.getState().items).toEqual([]); expect(f.accountChanged).toHaveBeenCalled();
  });
  it("rejects a late guest add after an account transition", async () => {
    const f = fixture(); await f.start(); let release!: (value: Response) => void;
    f.fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const add = f.store.getState().addItem({ id: secondId, name: "cached", price: 1, quantity: 1 });
    f.changeScope("account:owner-a"); await waitFor(() => f.store.getState().status === "ready");
    release(response({ success: true, lines: [line(secondId)] })); expect(await add).toBe(false);
    expect(f.store.getState().items[0].id).toBe(productId); expect(JSON.parse(f.values.get(GUEST_CART_KEY)!).lines).toEqual([]);
  });
  it("settles the captured guest receipt without changing a newly active account", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: secondId, name: "cached", price: 1, quantity: 2 });
    const context = f.store.getState().getCheckoutContext(), orderId = randomUUID(); context.lines[0].quantity = 1;
    f.changeScope("account:owner-a"); await waitFor(() => f.store.getState().status === "ready");
    expect(await f.store.getState().rememberCheckout(orderId, context.lines, null, context)).toBe(true);
    expect(await f.store.getState().completeCheckout(orderId, context)).toBe(false);
    expect(f.store.getState().items[0].id).toBe(productId); expect(f.store.getState().guestCart?.lines[0].quantity).toBe(1);
    expect(f.store.getState().guestCart?.ackPending?.orderId).toBe(orderId);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).includes(orderId))).toHaveLength(0);
    f.changeScope("guest"); await waitFor(() => f.store.getState().status === "ready");
    expect(f.store.getState().guestCart?.previousReceiptId).toBe(orderId); expect(f.store.getState().items[0].quantity).toBe(1);
  });
  it("writes receipt cleanup to storage before server acknowledgement and does not consume twice", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 3 });
    const context = f.store.getState().getCheckoutContext(), orderId = randomUUID(); context.lines[0].quantity = 1;
    f.fetcher.mockImplementationOnce(async (url) => {
      expect(url).toBe(`/api/checkout/${orderId}`); const durable = JSON.parse(f.values.get(GUEST_CART_KEY)!);
      expect(durable.lines[0].quantity).toBe(2); expect(durable.ackPending.orderId).toBe(orderId);
      return response({ cartAcknowledged: true });
    });
    expect(await f.store.getState().completeCheckout(orderId, context)).toBe(true);
    expect(f.store.getState().items[0].quantity).toBe(2);
    expect(await f.store.getState().completeCheckout(orderId, context)).toBe(true); expect(f.store.getState().items[0].quantity).toBe(2);
  });
  it("does not acknowledge a memory-only receipt or fabricate lineage for a legacy receipt", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 2 });
    const context = f.store.getState().getCheckoutContext(), orderId = randomUUID(); f.fetcher.mockClear(); f.block(true);
    expect(await f.store.getState().completeCheckout(orderId, context)).toBe(false);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).includes(orderId))).toHaveLength(0);
    expect(f.store.getState().guestCart?.ackPending?.orderId).toBe(orderId);
    expect(await f.store.getState().completeCheckout(randomUUID())).toBe(false); expect(f.store.getState().notice).toContain("no verified cart lineage");
  });
  it("explicitly merges guest quantities and keeps a concurrently changed guest line", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 2 });
    f.changeScope("account:owner-a"); await waitFor(() => f.store.getState().status === "ready");
    f.fetcher.mockImplementationOnce(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ action: "merge", items: [{ productId, quantity: 2 }] });
      const changed = JSON.parse(f.values.get(GUEST_CART_KEY)!); changed.revision++; changed.version++; changed.lines[0].version++; changed.lines[0].quantity = 3;
      f.values.set(GUEST_CART_KEY, JSON.stringify(changed));
      return response({ success: true, ownerId: "owner-a", acceptedIds: [productId], skippedIds: [] });
    });
    expect(await f.store.getState().mergeGuest()).toBe(true); expect(JSON.parse(f.values.get(GUEST_CART_KEY)!).lines[0].quantity).toBe(3);
    expect(f.store.getState().notice).toContain("Account coupon unchanged");
  });
  it("does not publish product data after cancellation and rejects checkout from a stale cross-tab guest snapshot", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 1 });
    const changed = JSON.parse(f.values.get(GUEST_CART_KEY)!); changed.revision++; changed.version++; changed.lines[0].quantity = 2;
    f.values.set(GUEST_CART_KEY, JSON.stringify(changed)); expect(() => f.store.getState().getCheckoutContext()).toThrow("another tab");
    let release!: (value: Response) => void; f.fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const loading = f.store.getState().refresh(); f.store.getState().cancel(); release(response({ success: true, lines: [line()] }));
    expect(await loading).toBe(false); expect(f.store.getState().items).toEqual([]); expect(f.store.getState().status).toBe("loading");
  });
  it("quarantines ownerless legacy data until explicit preview and staged import into the guest cart", async () => {
    const f = fixture("account:owner-a");
    f.values.set(LEGACY_CART_KEY, JSON.stringify({ state: { items: [{ id: secondId, quantity: 2, name: "Private stale title", price: 1 }], couponCode: "OLD" } }));
    await f.start(); expect(f.store.getState().items[0].id).toBe(productId); expect(f.store.getState().guestCart?.lines).toEqual([]);
    expect(JSON.stringify(f.store.getState().legacy)).not.toContain("Private stale title");
    expect(await f.store.getState().previewLegacy([0])).toBe(true); expect(f.store.getState().legacyProducts[secondId]?.price).toBe(100);
    expect(await f.store.getState().importLegacy([0], true)).toBe(true);
    expect(f.store.getState().items[0].id).toBe(productId); expect(f.store.getState().couponCode).toBeNull();
    expect(f.store.getState().guestCart).toMatchObject({ lines: [{ productId: secondId, quantity: 2 }], couponCode: "OLD" });
    expect(JSON.parse(f.values.get(LEGACY_CART_KEY)!).state.items).toEqual([]);
  });
  it("imports larger quantities without doubling retries and retains unavailable/overstock legacy rows", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 3 });
    f.values.set(LEGACY_CART_KEY, JSON.stringify({ state: { items: [{ id: productId, quantity: 2 }, { id: secondId, quantity: 11 }] } }));
    expect(await f.store.getState().importLegacy([0, 1])).toBe(true);
    expect(f.store.getState().items[0].quantity).toBe(3); expect(f.store.getState().items).toHaveLength(1);
    expect(JSON.parse(f.values.get(LEGACY_CART_KEY)!).state.items).toEqual([{ id: secondId, quantity: 11 }]);
    expect(f.store.getState().notice).toContain("1 selected row(s) retained");
  });
  it("keeps legacy raw rows when modern storage is blocked instead of reporting completed import", async () => {
    const f = fixture(); await f.start(); const raw = JSON.stringify({ state: { items: [{ id: productId, quantity: 2 }] } });
    f.values.set(LEGACY_CART_KEY, raw); f.block(true);
    expect(await f.store.getState().importLegacy([0])).toBe(false); expect(f.values.get(LEGACY_CART_KEY)).toBe(raw);
    expect(f.store.getState().guestCart?.lines[0].quantity).toBe(2); expect(f.store.getState().error).toContain("older storage was retained");
  });
  it("requires a real authorized terminal receipt before unblocking an older pending cart", async () => {
    const f = fixture(), orderId = randomUUID(), legacyLineId = randomUUID();
    f.values.set(LEGACY_CART_KEY, JSON.stringify({ state: { items: [{ id: productId, lineId: legacyLineId, quantity: 2 }], pendingCheckouts: { [orderId]: { items: [{ productId, lineId: legacyLineId, quantity: 1 }] } } } }));
    await f.start(); expect(await f.store.getState().importLegacy([0])).toBe(false);
    f.fetcher.mockImplementationOnce(async () => response({ message: "Access expired" }, 404));
    expect(await f.store.getState().recoverLegacyReceipt(orderId)).toBe(false); expect(f.store.getState().legacy.pendingOrderIds).toContain(orderId);
    f.fetcher.mockImplementationOnce(async () => response({ order: { id: orderId, status: "PROCESSING", paymentStatus: "PAID", paymentMethod: "STRIPE" } }));
    expect(await f.store.getState().recoverLegacyReceipt(orderId)).toBe(true); expect(f.store.getState().legacy.pendingOrderIds).toEqual([]);
    expect(f.store.getState().legacy.rows[0].quantity).toBe(1); expect(await f.store.getState().importLegacy([0])).toBe(true);
    expect(f.store.getState().items[0].quantity).toBe(1);
  });
  it("recovers an unknown COD response from the original secret, persists receipt cleanup and clears only its namespace", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 3 });
    const context = f.store.getState().getCheckoutContext(), orderId = randomUUID(); context.lines[0].quantity = 1;
    const attempt = await getCheckoutAttempt({ cart: context, items: context.lines, fullName: "Private recipient", phone: "01700000000", street: "Private road", city: "Dhaka", district: "Dhaka", paymentMethod: "COD" }, undefined, f.attemptStorage);
    f.fetcher.mockImplementationOnce(async (url, init) => {
      expect(url).toBe("/api/checkout/attempt"); expect(JSON.parse(String(init?.body))).toEqual({ checkoutToken: attempt.token, ownerId: null, sourceId: context.sourceId });
      return response({ success: true, order: { id: orderId, status: "PROCESSING", paymentStatus: "UNPAID", paymentMethod: "COD", createdAt: "2026-10-29T00:00:00.000Z", cartSnapshot: context } });
    });
    expect(await f.store.getState().recoverCheckoutAttempt()).toBe(true); expect(f.store.getState().items[0].quantity).toBe(2);
    expect(f.store.getState().guestCart?.previousReceiptId).toBe(orderId); expect(f.store.getState().recentCheckout?.id).toBe(orderId);
    expect(readCheckoutAttempt(context, f.attemptStorage)).toBeUndefined(); expect(JSON.stringify(f.store.getState())).not.toContain(attempt.token);
  });
  it("recovers a pending guest receipt without subtracting items and retains its secret for resume", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 2 });
    const context = f.store.getState().getCheckoutContext(), orderId = randomUUID();
    await getCheckoutAttempt({ cart: context, items: context.lines, fullName: "Recipient", phone: "01700000000", street: "Road", city: "Dhaka", district: "Dhaka", paymentMethod: "STRIPE" }, undefined, f.attemptStorage);
    f.fetcher.mockImplementationOnce(async () => response({ success: true, order: { id: orderId, status: "PENDING", paymentStatus: "UNPAID", paymentMethod: "STRIPE", cartSnapshot: context } }));
    expect(await f.store.getState().recoverCheckoutAttempt()).toBe(true); expect(f.store.getState().items[0].quantity).toBe(2);
    expect(f.store.getState().pendingCheckouts[orderId].items[0].quantity).toBe(2); expect(readCheckoutAttempt(context, f.attemptStorage)?.orderId).toBe(orderId);
  });
  it("never treats a missing receipt as permission to erase or rotate its original secret", async () => {
    const f = fixture(); await f.start(); await f.store.getState().addItem({ id: productId, name: "cached", price: 1, quantity: 1 });
    const context = f.store.getState().getCheckoutContext();
    const attempt = await getCheckoutAttempt({ cart: context, items: context.lines, fullName: "Recipient", phone: "01700000000", street: "Road", city: "Dhaka", district: "Dhaka", paymentMethod: "COD" }, undefined, f.attemptStorage);
    f.fetcher.mockImplementationOnce(async () => response({ success: false, message: "No confirmed checkout receipt found" }, 404));
    expect(await f.store.getState().recoverCheckoutAttempt()).toBe(false); expect(readCheckoutAttempt(context, f.attemptStorage)?.token).toBe(attempt.token);
    expect(f.store.getState().items[0].quantity).toBe(1);
  });
});
