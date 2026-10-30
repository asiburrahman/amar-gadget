import { webcrypto } from "node:crypto";
import { createCartController, type CartItem } from "@/lib/client/cart-controller";

// HTTP/storage fixtures for DOM tests only. Components exercise the actual
// controller and receipt transitions; provider behavior is not certified here.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
if (typeof structuredClone === "undefined") Object.defineProperty(globalThis, "structuredClone", { value: (value: unknown) => JSON.parse(JSON.stringify(value)), configurable: true });
let active = createCartController({ fetcher: async () => { throw new Error("Initialize the cart HTTP fixture before rendering"); }, storage: () => undefined });
export const useFixtureCartStore = new Proxy(active, {
  apply: (_target, thisArg, args) => Reflect.apply(active, thisArg, args),
  get: (_target, key) => Reflect.get(active, key),
});
export async function seedClientCart(items: CartItem[] = [], options: { existing?: Map<string, string>; catalog?: CartItem[]; ownerId?: string } = {}) {
  active.getState().cancel();
  const values = options.existing ?? new Map<string, string>();
  const catalog = new Map((options.catalog ?? items).map((item) => [item.id, { id: item.id, name: item.name, slug: item.id, price: item.price, discountPrice: item.discountPrice ?? null, stock: item.stock ?? 100, category: item.category ?? "Gadgets", imageUrl: item.imageUrl ?? null }]));
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const accountLines = items.map((item) => ({ id: item.id, lineId: webcrypto.randomUUID(), lineVersion: 1, quantity: item.quantity, product: catalog.get(item.id) ?? null }));
  const boundary = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === "/api/cart/guest") return { ok: true, json: async () => ({ success: true, lines: body.lines.map((line: { productId: string; lineId: string; quantity: number }) => ({ id: line.productId, lineId: line.lineId, lineVersion: 1, quantity: line.quantity, product: catalog.get(line.productId) ?? null })) }) } as Response;
    if (url === "/api/cart" && (!init?.method || init.method === "GET")) return { ok: true, json: async () => ({ success: true, ownerId: options.ownerId, version: 0, couponVersion: 0, couponCode: null, lines: accountLines, pendingCheckouts: {} }) } as Response;
    if (String(url).startsWith("/api/checkout/") && body?.action === "ack-cart") return { ok: true, json: async () => ({ cartAcknowledged: true }) } as Response;
    throw new Error(`Unexpected cart-controller HTTP fixture request: ${url}`);
  });
  active = createCartController({ fetcher: boundary, storage: () => storage, scopeNow: () => options.ownerId ? `account:${options.ownerId}` : "guest" });
  await active.getState().initialize(); active.getState().setScope(options.ownerId ? `account:${options.ownerId}` : "guest"); await active.getState().refresh();
  if (!options.existing && !options.ownerId) for (const item of items) {
    if (!await active.getState().addItem(item)) throw new Error("DOM cart fixture failed to populate its guest cart");
  }
  return { values, catalog, boundary, store: active };
}
