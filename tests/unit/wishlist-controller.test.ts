import { createWishlistController, GUEST_WISHLIST_KEY, LEGACY_WISHLIST_KEY } from "@/lib/client/wishlist-controller";
import type { WishlistEntry } from "@/lib/validations/wishlist";
const product = (id: string): WishlistEntry => ({ id, product: { id, name: `Current ${id}`, slug: id, price: 100, discountPrice: 80, stock: 2, imageUrl: null, category: "Gadgets" } });
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
const snapshot = (ownerId: string, items: WishlistEntry[], version = 0, page = 1, totalPages = 1) => ({ success: true, ownerId, items, version, page, total: items.length, totalPages });
const wait = async (ready: () => boolean) => { const deadline = Date.now() + 2000; while (!ready()) { if (Date.now() > deadline) throw new Error("Wishlist state deadline exceeded"); await new Promise((resolve) => setTimeout(resolve, 1)); } };
const storage = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
const active: ReturnType<typeof createWishlistController>[] = [];
const controller = (deps: Parameters<typeof createWishlistController>[0]) => { const store = createWishlistController(deps); active.push(store); return store; };
afterEach(() => active.splice(0).forEach((store) => store.getState().cancel()));
it("keeps old ownerless cached metadata quarantined until explicit import, then persists product IDs only", async () => {
  const local = storage(); local.setItem(LEGACY_WISHLIST_KEY, JSON.stringify({ state: { items: [{ id: "old-product", name: "Private old account product", price: 99999 }] } }));
  const fetcher = jest.fn(async () => response({ success: true, items: [product("old-product")] }));
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("guest");
  await wait(() => store.getState().status === "ready"); expect(store.getState().items).toEqual([]); expect(store.getState().legacyIds).toEqual(["old-product"]); expect(fetcher).not.toHaveBeenCalled();
  await store.getState().importLegacy(); expect(store.getState().items[0].product?.name).toBe("Current old-product");
  expect(local.getItem(GUEST_WISHLIST_KEY)).toBe('["old-product"]'); expect(local.getItem(LEGACY_WISHLIST_KEY)).toBeNull();
});
it("does not copy guest items into an account automatically or persist account snapshots", async () => {
  const local = storage(); local.setItem(GUEST_WISHLIST_KEY, '["guest-product"]');
  const fetcher = jest.fn(async () => response(snapshot("owner", [product("account-product")])));
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("account:owner");
  await wait(() => store.getState().status === "ready"); expect(store.getState().items.map((row) => row.id)).toEqual(["account-product"]);
  expect(fetcher.mock.calls).toHaveLength(1); expect(local.getItem(GUEST_WISHLIST_KEY)).toBe('["guest-product"]'); expect([...local.values.values()].join()).not.toContain("account-product");
});
it("sends the expected account precondition and changes hearts only after confirmed mutation and sync", async () => {
  let items: WishlistEntry[] = [], finish!: () => void;
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") { await new Promise<void>((resolve) => { finish = resolve; }); items = [product("real-product")]; return response({ success: true, ownerId: "owner", acceptedIds: ["real-product"], skippedIds: [], added: 1, version: 1 }); }
    return response(snapshot("owner", items, items.length));
  });
  const store = controller({ fetcher }); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  const saved = store.getState().addItem({ id: "real-product", name: "Caller name", price: 9999 });
  await wait(() => Boolean(finish)); expect(store.getState().isInWishlist("real-product")).toBe(false);
  const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!; expect(call[1]?.headers).toMatchObject({ "X-Wishlist-Owner": "owner" }); expect(JSON.parse(call[1]?.body as string)).toEqual({ productIds: ["real-product"] });
  finish(); expect(await saved).toBe(true); expect(store.getState().isInWishlist("real-product")).toBe(true); expect(store.getState().items[0].product?.price).toBe(100);
});
it("retains server state and shows an actual failure instead of an optimistic saved heart", async () => {
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => response(init?.method ? { success: false, message: "Wishlist limit reached" } : snapshot("owner", []), !init?.method));
  const store = controller({ fetcher }); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  expect(await store.getState().addItem({ id: "new-product" })).toBe(false); expect(store.getState().items).toEqual([]); expect(store.getState().error).toBe("Wishlist limit reached");
});
it("drops a previous account immediately and ignores its late read response", async () => {
  let finish!: (value: Response) => void;
  const fetcher = jest.fn((url: RequestInfo | URL, init?: RequestInit) => (init?.headers as Record<string, string>)["X-Wishlist-Owner"] === "old-owner" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response(snapshot("new-owner", [product("new-product")]))));
  const store = controller({ fetcher }); store.getState().setScope("account:old-owner"); store.getState().setScope("account:new-owner");
  await wait(() => store.getState().status === "ready"); finish(response(snapshot("old-owner", [product("private-old-product")]))); await new Promise((resolve) => setTimeout(resolve, 1));
  expect(store.getState().items.map((row) => row.id)).toEqual(["new-product"]);
});
it("ignores a late mutation response after an account change and never consumes another account's guest items", async () => {
  const local = storage(); local.setItem(GUEST_WISHLIST_KEY, '["guest-product"]'); let finish!: (value: Response) => void;
  const fetcher = jest.fn((url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response(snapshot((init?.headers as Record<string, string>)["X-Wishlist-Owner"], []))));
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("account:old-owner"); await wait(() => store.getState().status === "ready");
  const merged = store.getState().mergeGuest(); store.getState().setScope("account:new-owner"); await wait(() => store.getState().status === "ready");
  finish(response({ success: true, ownerId: "old-owner", acceptedIds: ["guest-product"], skippedIds: [], version: 1 })); expect(await merged).toBe(false);
  expect(store.getState().scope).toBe("account:new-owner"); expect(local.getItem(GUEST_WISHLIST_KEY)).toBe('["guest-product"]'); expect(store.getState().items).toEqual([]);
});
it("consumes only accepted guest IDs after an explicit merge and leaves unavailable IDs for review", async () => {
  const local = storage(); local.setItem(GUEST_WISHLIST_KEY, '["accepted-product","hidden-product"]'); let merged = false;
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") { merged = true; return response({ success: true, ownerId: "owner", acceptedIds: ["accepted-product"], skippedIds: ["hidden-product"], version: 1 }); }
    return response(snapshot("owner", merged ? [product("accepted-product")] : [], merged ? 1 : 0));
  });
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  expect(await store.getState().mergeGuest()).toBe(true); expect(local.getItem(GUEST_WISHLIST_KEY)).toBe('["hidden-product"]'); expect(store.getState().notice).toContain("1 unavailable");
});
it("reports a committed mutation truthfully when its subsequent read fails", async () => {
  let saved = false;
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") { saved = true; return response({ success: true, ownerId: "owner", acceptedIds: ["new-product"], skippedIds: [], version: 1 }); }
    return saved ? response({ success: false, message: "Read unavailable" }, false) : response(snapshot("owner", []));
  });
  const store = controller({ fetcher }); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  expect(await store.getState().addItem({ id: "new-product" })).toBe(true); expect(store.getState().status).toBe("error"); expect(store.getState().notice).toContain("change was saved"); expect(store.getState().items).toEqual([]);
});
it("never publishes mixed-version pages and retries a complete snapshot before showing it", async () => {
  let read = 0;
  const pages = [snapshot("owner", [product("old-page")], 1, 1, 2), snapshot("owner", [product("mixed-page")], 2, 2, 2), snapshot("owner", [product("current-first")], 2, 1, 2), snapshot("owner", [product("current-second")], 2, 2, 2)];
  const fetcher = jest.fn(async () => response(pages[read++])); const store = controller({ fetcher }); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  expect(store.getState().items.map((row) => row.id)).toEqual(["current-first", "current-second"]); expect(store.getState().version).toBe(2);
});
it("passes current revision to clear and switches to only guest data on logout", async () => {
  const local = storage(); local.setItem(GUEST_WISHLIST_KEY, '["guest-product"]');
  const fetcher = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => response(String(url).endsWith("/guest") ? { success: true, items: [product("guest-product")] } : init?.method === "DELETE" ? { success: true, ownerId: "owner", version: 8 } : snapshot("owner", [product("account-product")], 7)));
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  await store.getState().clearWishlist(); const call = fetcher.mock.calls.find(([, init]) => init?.method === "DELETE")!; expect(JSON.parse(call[1]?.body as string)).toEqual({ clear: true, version: 7 });
  store.getState().setScope("guest"); await wait(() => store.getState().status === "ready"); expect(store.getState().items.map((row) => row.id)).toEqual(["guest-product"]);
});
it("recovers from provider unmount/cancellation with a fresh read and no permanently busy state", async () => {
  const fetcher = jest.fn(async () => response(snapshot("owner", []))); const store = controller({ fetcher });
  store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready"); store.getState().cancel();
  expect(await store.getState().refresh()).toBe(true); expect(store.getState().busy).toBe(false); expect(store.getState().status).toBe("ready");
});
it("keeps a committed merge successful if browser cleanup storage fails and leaves its guest IDs recoverable", async () => {
  const local = storage(); local.setItem(GUEST_WISHLIST_KEY, '["guest-product"]');
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => response(init?.method === "POST" ? { success: true, ownerId: "owner", acceptedIds: ["guest-product"], skippedIds: [], version: 1 } : snapshot("owner", [])));
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  local.setItem = () => { throw new Error("Storage blocked fixture"); };
  expect(await store.getState().mergeGuest()).toBe(true); expect(store.getState().guestIds).toEqual(["guest-product"]); expect(store.getState().notice).toContain("1 guest item(s) remain");
});
it("normalizes browser and caller IDs before deduplication so a displayed guest item can always be removed", async () => {
  const local = storage(); local.setItem(GUEST_WISHLIST_KEY, '[" product ","product"]');
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => response({ success: true, items: JSON.parse(init?.body as string).productIds.map(product) }));
  const store = controller({ fetcher, storage: () => local }); store.getState().initialize(); store.getState().setScope("guest"); await wait(() => store.getState().status === "ready");
  expect(store.getState().guestIds).toEqual(["product"]); expect(await store.getState().removeItem("product")).toBe(true); expect(local.getItem(GUEST_WISHLIST_KEY)).toBe("[]");
  expect(await store.getState().addItem({ id: " new-product " })).toBe(true); expect(local.getItem(GUEST_WISHLIST_KEY)).toBe('["new-product"]'); expect(store.getState().isInWishlist("new-product")).toBe(true);
});
it("keeps malformed older cache quarantined and available for explicit discard", () => {
  const local = storage(); local.setItem(LEGACY_WISHLIST_KEY, JSON.stringify({ state: { items: [{ id: "../invalid", name: "Old private name" }] } }));
  const store = controller({ fetcher: jest.fn(), storage: () => local }); store.getState().initialize(); expect(store.getState().legacyInvalid).toBe(true); expect(store.getState().items).toEqual([]);
  store.getState().discardLegacy(); expect(local.getItem(LEGACY_WISHLIST_KEY)).toBeNull();
});
it("falls back to the same guest operation once when browser locking is unavailable", async () => {
  const local = storage(), lock = jest.fn(async () => { throw new Error("Web Locks unavailable fixture"); });
  const fetcher = jest.fn(async () => response({ success: true, items: [product("new-product")] }));
  const store = controller({ fetcher, storage: () => local, lock }); store.getState().initialize(); store.getState().setScope("guest"); await wait(() => store.getState().status === "ready");
  expect(await store.getState().addItem({ id: "new-product" })).toBe(true); expect(local.getItem(GUEST_WISHLIST_KEY)).toBe('["new-product"]'); expect(lock).toHaveBeenCalledTimes(1);
});
it("does not turn a committed save into failure if a browser broadcast cannot be sent", async () => {
  const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => response(init?.method === "POST" ? { success: true, ownerId: "owner", acceptedIds: ["new-product"], skippedIds: [], version: 1 } : snapshot("owner", [])));
  const store = controller({ fetcher, notify: () => { throw new Error("Broadcast unavailable fixture"); } }); store.getState().setScope("account:owner"); await wait(() => store.getState().status === "ready");
  expect(await store.getState().addItem({ id: "new-product" })).toBe(true); expect(store.getState().error).toBe(""); expect(store.getState().notice).toBe("Wishlist change saved.");
});
