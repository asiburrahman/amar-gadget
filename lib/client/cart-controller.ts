import { create } from "zustand";
import { z } from "zod";
import { cartCheckoutSchema, cartCouponSchema, cartMutationSchema, type AccountCartSnapshot, type CartCheckoutContext, type CartMutation, type CartPending, type CartViewLine, type CartRecentCheckout } from "@/lib/validations/cart";
import { acknowledgeGuestReceipt, clearGuestItems, createGuestCartRepository, guestCheckoutContext, rememberGuestReceipt, removeGuestLine, setGuestCoupon, setGuestQuantity, settleGuestReceipt, GuestCartError, type GuestCart } from "@/lib/client/guest-cart";
import { createLegacyCartRepository, inspectLegacyCart, type LegacyCartSummary } from "@/lib/client/legacy-cart";
import type { WishlistProduct } from "@/lib/validations/wishlist";
import { bindCheckoutAttempt, clearCheckoutAttemptForOrder, readCheckoutAttempt } from "@/lib/checkout-attempt";

export type CartScope = "loading" | "guest" | `account:${string}`;
export interface CartItem {
  id: string; lineId?: string; lineVersion?: number; quantity: number; name: string; price: number;
  discountPrice?: number | null; imageUrl?: string | null; stock?: number; category?: string; brand?: string; available?: boolean;
}
type Dependencies = {
  fetcher: typeof fetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
  lock?: <T>(work: () => Promise<T>) => Promise<T>; scopeNow?: () => CartScope;
  notify?: (ownerId: string | null) => void; accountChanged?: () => void;
  attemptStorage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
};
export interface CartState {
  scope: CartScope; items: CartItem[]; couponCode: string | null; couponVersion: number | null; version: number | null;
  catalogRevision: number;
  status: "loading" | "ready" | "error"; busy: boolean; refreshing: boolean; error: string; notice: string;
  guestCart: GuestCart | null; memoryOnly: boolean; pendingCheckouts: Record<string, CartPending>;
  legacy: LegacyCartSummary; legacyProducts: Record<string, WishlistProduct | null>; legacyBusy: boolean;
  recentCheckout: CartRecentCheckout | null;
  initialize: () => Promise<void>; setScope: (scope: CartScope) => void; refresh: () => Promise<boolean>; cancel: () => void;
  syncBrowserStorage: () => Promise<void>; retryStorage: () => Promise<boolean>; dismissNotice: () => void;
  addItem: (item: CartItem) => Promise<boolean>; updateQuantity: (id: string, quantity: number) => Promise<boolean>;
  removeItem: (id: string) => Promise<boolean>; clearCart: () => Promise<boolean>; applyCoupon: (code: string) => Promise<boolean>; removeCoupon: () => Promise<boolean>;
  mergeGuest: () => Promise<boolean>; discardGuest: () => Promise<boolean>;
  previewLegacy: (indices: number[]) => Promise<boolean>; importLegacy: (indices: number[], includeCoupon?: boolean) => Promise<boolean>;
  repairLegacyQuantity: (index: number, quantity: number) => Promise<boolean>; recoverLegacyReceipt: (orderId: string) => Promise<boolean>; discardLegacy: () => Promise<boolean>;
  getCheckoutContext: () => CartCheckoutContext;
  rememberCheckout: (orderId: string, items: { productId: string; quantity: number; lineId?: string }[], couponCode: string | null, context?: CartCheckoutContext) => Promise<boolean>;
  completeCheckout: (orderId: string, context?: unknown) => Promise<boolean>; forgetCheckout: (orderId: string, context?: unknown) => Promise<boolean>;
  recoverCheckoutAttempt: (silent?: boolean) => Promise<boolean>;
}
const pendingMap = (cart: GuestCart): Record<string, CartPending> => Object.fromEntries(cart.pending.map(({ orderId, context }) => [orderId, { items: context.lines, ownerId: null, sourceId: cart.id, couponCode: context.couponCode, couponVersion: context.couponVersion, version: context.version }]));
function flatten(lines: CartViewLine[]): CartItem[] {
  return lines.map((line) => ({ id: line.id, lineId: line.lineId, lineVersion: line.lineVersion, quantity: line.quantity,
    name: line.product?.name ?? "Unavailable product", price: line.product?.price ?? 0, discountPrice: line.product?.discountPrice ?? null,
    imageUrl: line.product?.imageUrl ?? null, category: line.product?.category, stock: line.product?.stock ?? 0, available: line.product !== null,
  }));
}
export function createCartController(deps: Dependencies) {
  const guest = createGuestCartRepository(deps);
  const legacy = createLegacyCartRepository(deps);
  let epoch = 0, generation = 0, reader: AbortController | undefined, writer: AbortController | undefined, legacyReader: AbortController | undefined;
  const store = create<CartState>((set, get) => {
    const message = (error: unknown) => error instanceof Error ? error.message : "Unable to confirm this cart change. Refresh before retrying.";
    const syncScope = () => { const observed = deps.scopeNow?.(); if (observed && observed !== get().scope) get().setScope(observed); return get().scope; };
    const current = (scope: CartScope, captured: number) => scope === syncScope() && epoch === captured;
    const broadcast = (scope: CartScope) => { try { deps.notify?.(scope.startsWith("account:") ? scope.slice(8) : null); } catch { /* Focus/polling still refreshes committed data. */ } };
    function publishGuest(cart: GuestCart, durable = !guest.isMemoryOnly()) {
      set({ guestCart: cart, memoryOnly: !durable });
      if (get().scope === "guest") set({ version: cart.version, couponCode: cart.couponCode, couponVersion: cart.couponVersion, pendingCheckouts: pendingMap(cart) });
    }
    async function request(url: string, init: RequestInit, scope: CartScope) {
      const response = await deps.fetcher(url, { ...init, cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(url === "/api/cart" && scope.startsWith("account:") ? { "X-Cart-Owner": scope.slice(8) } : {}) } });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        if (data.code === "CART_ACCOUNT_CHANGED" && get().scope === scope) { set({ items: [], pendingCheckouts: {}, status: "error", version: null }); deps.accountChanged?.(); }
        throw new Error(data.message || "Cart request failed. Refresh before retrying.");
      }
      if (url === "/api/cart" && (!scope.startsWith("account:") || data.ownerId !== scope.slice(8))) throw new Error("The active cart account changed. Refresh your session.");
      return data;
    }
    async function acknowledge(cart: GuestCart, signal?: AbortSignal) {
      if (!cart.ackPending) return cart;
      if (syncScope() !== "guest") throw new Error("Use the original guest session to finish saving this checkout receipt.");
      const flushed = await guest.flush(); publishGuest(flushed.cart, flushed.durable);
      if (!flushed.durable) throw new Error("Keep this tab open. Enable browser storage and retry saving the receipt before another guest checkout.");
      const orderId = flushed.cart.ackPending?.orderId;
      if (!orderId) return flushed.cart;
      const data = await request(`/api/checkout/${orderId}`, { method: "POST", body: JSON.stringify({ action: "ack-cart" }), signal }, "guest");
      if (!data.cartAcknowledged) throw new Error("Checkout receipt acknowledgement could not be confirmed.");
      // If another tab changed the cart while HTTP was in flight, don't
      // overwrite it. Retrying this idempotent acknowledgement is safe.
      const latest = guest.read();
      const saved = await guest.change(latest, (value) => acknowledgeGuestReceipt(value, orderId));
      publishGuest(saved.cart, saved.durable);
      if (!saved.durable) throw new Error("The server received this receipt. Keep the tab open and retry saving browser storage.");
      return saved.cart;
    }
    async function resolveGuest(cart: GuestCart, signal?: AbortSignal): Promise<CartViewLine[]> {
      if (!cart.lines.length) return [];
      return (await request("/api/cart/guest", { method: "POST", body: JSON.stringify({ lines: cart.lines.map(({ productId, lineId, quantity }) => ({ productId, lineId, quantity })) }), signal }, "guest")).lines;
    }
    async function load() {
      const scope = syncScope(), captured = epoch;
      if (scope === "loading") return false;
      const token = ++generation; reader?.abort(); const controller = new AbortController(); reader = controller;
      const timer = setTimeout(() => controller.abort(), 30_000);
      set({ refreshing: true, ...(get().status === "ready" ? {} : { status: "loading" as const }) });
      try {
        if (scope === "guest") {
          let cart = guest.read(); publishGuest(cart);
          if (cart.ackPending) cart = await acknowledge(cart, controller.signal);
          const lines = await resolveGuest(cart, controller.signal);
          const latest = guest.read();
          if (latest.id !== cart.id || latest.revision !== cart.revision) throw new Error("Guest cart changed during refresh. Refresh to review its current contents.");
          if (token === generation && current(scope, captured) && !controller.signal.aborted) {
            publishGuest(cart); set({ items: flatten(lines), status: "ready", error: "", catalogRevision: get().catalogRevision + 1 }); return true;
          }
        } else {
          const snapshot: AccountCartSnapshot = await request("/api/cart", { signal: controller.signal }, scope);
          if (token === generation && current(scope, captured) && !controller.signal.aborted) {
            set({ items: flatten(snapshot.lines), version: snapshot.version, couponCode: snapshot.couponCode, couponVersion: snapshot.couponVersion, pendingCheckouts: snapshot.pendingCheckouts, recentCheckout: snapshot.recentCheckout ?? null, status: "ready", error: "", catalogRevision: get().catalogRevision + 1 }); return true;
          }
        }
      } catch (error) {
        if (token === generation && current(scope, captured)) set({ status: "error", error: controller.signal.aborted ? "Cart sync timed out. Refresh before checkout." : message(error) });
      } finally { clearTimeout(timer); if (token === generation && current(scope, captured)) set({ refreshing: false }); }
      return false;
    }
    const ready = () => syncScope() !== "loading" && get().status === "ready" && !get().busy && !get().refreshing;
    async function changeGuest(transform: (cart: GuestCart) => GuestCart, expected = guest.read()) {
      const saved = await guest.change(expected, transform); publishGuest(saved.cart, saved.durable);
      set({ notice: saved.durable ? "Guest cart saved in this browser." : "Cart saved for this tab only. Keep it open; browser storage is unavailable." });
      return saved;
    }
    async function accountChange(input: CartMutation, consume?: GuestCart) {
      const scope = syncScope(), captured = epoch;
      if (!scope.startsWith("account:") || !ready()) return false;
      reader?.abort(); generation++; writer = new AbortController(); const controller = writer, timer = setTimeout(() => controller.abort(), 30_000);
      set({ busy: true, refreshing: false, error: "", notice: "" });
      try {
        const parsed = cartMutationSchema.parse(input);
        const result = await request("/api/cart", { method: "POST", body: JSON.stringify(parsed), signal: controller.signal }, scope);
        // A committed merge can clean up only the exact guest lines observed
        // before the request. Account changes never redirect that write.
        if (consume) {
          try {
            const latest = guest.read();
            if (latest.id === consume.id) {
              const accepted = new Set<string>(result.acceptedIds);
              await changeGuest((cart) => {
                let updated = cart;
                for (const line of consume.lines) if (accepted.has(line.productId) && cart.lines.some((saved) => saved.lineId === line.lineId && saved.version === line.version && saved.quantity === line.quantity)) updated = removeGuestLine(updated, line.lineId);
                return updated;
              }, latest);
            }
          } catch { /* Server committed. Retaining guest lines is safe: merge takes max quantities. */ }
        }
        broadcast(scope);
        if (!current(scope, captured)) return false;
        set({ notice: consume ? `Guest merge saved. ${result.skippedIds.length} unavailable item(s) retained. Account coupon unchanged.` : "Account cart change saved." });
        const loaded = await load();
        if (!loaded && current(scope, captured)) set({ notice: "Cart change was saved. Refresh to review the current cart." });
        return true;
      } catch (error) {
        if (current(scope, captured)) { set({ error: message(error) }); await load(); set({ error: message(error) }); }
        return false;
      } finally { clearTimeout(timer); if (current(scope, captured)) set({ busy: false }); }
    }
    async function localChange(transform: (cart: GuestCart) => GuestCart, expected?: GuestCart) {
      const scope = syncScope(), captured = epoch;
      if (scope !== "guest" || get().busy) return false;
      reader?.abort(); generation++; set({ busy: true, refreshing: false, error: "" });
      try {
        await changeGuest(transform, expected); broadcast("guest");
        if (!current(scope, captured)) return false;
        const loaded = await load();
        if (!loaded && current(scope, captured)) set({ notice: "Your change was saved. Refresh current prices and stock before checkout." });
        return true;
      } catch (error) { if (current(scope, captured)) set({ error: message(error) }); return false; }
      finally { if (current(scope, captured)) set({ busy: false }); }
    }
    async function setQuantity(id: string, quantity: number) {
      const scope = syncScope(), captured = epoch, line = get().items.find((item) => item.id === id);
      const retainedGuestDecrease = scope === "guest" && !!line && quantity < line.quantity && !get().busy && !get().refreshing;
      if (!ready() && !retainedGuestDecrease) { set({ error: "Wait for cart sync or refresh before changing quantities." }); return false; }
      if (scope.startsWith("account:")) return accountChange({ action: "set", productId: id, quantity, lineId: line?.lineId ?? null, version: get().version!, requestId: globalThis.crypto.randomUUID() });
      const selected = guest.read();
      try {
        z.string().uuid().parse(id); z.number().int().min(1).max(100).parse(quantity);
        if (!line || quantity > line.quantity) {
          // Resolve before the storage lock, then compare the exact revision
          // after HTTP; never lock a browser cart while waiting on a provider.
          const probe = { productId: id, lineId: line?.lineId ?? globalThis.crypto.randomUUID(), quantity };
          set({ busy: true });
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000); writer = controller;
          let data;
          try { data = await request("/api/cart/guest", { method: "POST", body: JSON.stringify({ lines: [probe] }), signal: controller.signal }, scope); }
          finally { clearTimeout(timer); if (current(scope, captured)) set({ busy: false }); }
          if (!current(scope, captured)) return false;
          if (!data.lines[0]?.product || data.lines[0].product.stock < quantity) throw new Error("This product is unavailable in that quantity. Refresh current stock.");
        }
        if (!current(scope, captured)) return false;
        return localChange((cart) => setGuestQuantity(cart, id, quantity), selected);
      } catch (error) { if (current(scope, captured)) set({ error: message(error), busy: false }); return false; }
    }
    async function settle(orderId: string, context: unknown, outcome: "purchased" | "closed") {
      const parsed = cartCheckoutSchema.safeParse(context);
      if (!parsed.success) { set({ notice: "This older receipt has no verified cart lineage. Review current cart quantities; no unrelated items were removed." }); return false; }
      if (parsed.data.ownerId !== null) {
        if (syncScope() === `account:${parsed.data.ownerId}`) return load();
        return true; // Trusted server consumption never writes to another active account.
      }
      try {
        let saved: { cart: GuestCart; durable: boolean } | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          const cart = guest.read(); if (cart.id !== parsed.data.sourceId) return false;
          try { saved = await guest.change(cart, (value) => settleGuestReceipt(value, orderId, parsed.data, outcome)); break; }
          catch (error) {
            // This trusted receipt transition is idempotent by settledVersion.
            // It may retry a competing cleanup, unlike an uncertain increment.
            if (!(error instanceof GuestCartError) || error.code !== "CART_CHANGED" || attempt === 2) throw error;
          }
        }
        if (!saved) return false;
        publishGuest(saved.cart, saved.durable); broadcast("guest");
        if (saved.cart.ackPending && saved.durable) await acknowledge(saved.cart);
        else if (saved.cart.ackPending) set({ error: "Keep this tab open and enable browser storage to save your checkout receipt." });
        if (syncScope() === "guest") await load();
        return !get().guestCart?.ackPending;
      } catch (error) { set({ error: message(error) }); return false; }
    }
    async function legacyWork(work: (scope: CartScope, captured: number, signal: AbortSignal) => Promise<boolean>) {
      const scope = syncScope(), captured = epoch;
      if (scope === "loading" || get().legacyBusy) return false;
      const controller = new AbortController(); legacyReader = controller;
      const timer = setTimeout(() => controller.abort(), 30_000);
      set({ legacyBusy: true, error: "", notice: "" });
      try { return await work(scope, captured, controller.signal); }
      catch (error) { if (current(scope, captured)) set({ error: message(error) }); return false; }
      finally { clearTimeout(timer); if (current(scope, captured)) set({ legacyBusy: false }); }
    }
    return {
      scope: "loading", items: [], couponCode: null, couponVersion: null, version: null, catalogRevision: 0, status: "loading", busy: false, refreshing: false, error: "", notice: "", guestCart: null, memoryOnly: false, pendingCheckouts: {},
      legacy: inspectLegacyCart(null), legacyProducts: {}, legacyBusy: false, recentCheckout: null,
      initialize: async () => {
        try { const result = await guest.initialize(); publishGuest(result.cart, result.durable); } catch (error) { set({ error: message(error) }); }
        try { set({ legacy: legacy.read().summary }); } catch (error) { set({ error: message(error) }); }
      },
      setScope: (scope) => { if (scope === get().scope) return; epoch++; generation++; reader?.abort(); writer?.abort(); legacyReader?.abort(); set({ scope, items: [], couponCode: null, couponVersion: null, version: null, pendingCheckouts: {}, status: "loading", busy: false, refreshing: false, error: "", notice: "", legacyProducts: {}, legacyBusy: false, recentCheckout: null }); if (scope !== "loading") void load(); },
      refresh: async () => get().busy ? false : load(),
      cancel: () => { epoch++; generation++; reader?.abort(); writer?.abort(); legacyReader?.abort(); set({ items: [], pendingCheckouts: {}, version: null, couponVersion: null, couponCode: null, status: "loading", busy: false, refreshing: false, legacyBusy: false, legacyProducts: {}, recentCheckout: null }); },
      syncBrowserStorage: async () => {
        try { publishGuest(guest.read()); if (get().scope === "guest" && !get().busy) await load(); } catch (error) { set({ error: message(error), ...(get().scope === "guest" ? { status: "error" as const } : {}) }); }
        try { set({ legacy: legacy.read().summary, legacyProducts: {} }); } catch (error) { set({ error: message(error) }); }
      },
      retryStorage: async () => { try { const result = await guest.flush(); publishGuest(result.cart, result.durable); if (result.durable && get().scope === "guest") await load(); return result.durable; } catch (error) { set({ error: message(error) }); return false; } },
      dismissNotice: () => set({ notice: "" }),
      addItem: (item) => setQuantity(item.id, (get().items.find((line) => line.id === item.id)?.quantity ?? 0) + item.quantity),
      updateQuantity: setQuantity,
      removeItem: async (id) => {
        const scope = syncScope(), line = get().items.find((item) => item.id === id);
        if (!line?.lineId) return false;
        return scope === "guest" ? localChange((cart) => removeGuestLine(cart, line.lineId!)) : accountChange({ action: "remove", lineId: line.lineId, version: get().version!, requestId: globalThis.crypto.randomUUID() });
      },
      clearCart: () => syncScope() === "guest" ? localChange(clearGuestItems) : accountChange({ action: "clear", version: get().version!, requestId: globalThis.crypto.randomUUID() }),
      applyCoupon: async (code) => { const parsed = cartCouponSchema.safeParse(code); if (!parsed.success) { set({ error: "Enter a valid coupon code." }); return false; } return syncScope() === "guest" ? localChange((cart) => setGuestCoupon(cart, parsed.data)) : accountChange({ action: "coupon", code: parsed.data, version: get().version!, requestId: globalThis.crypto.randomUUID() }); },
      removeCoupon: () => syncScope() === "guest" ? localChange((cart) => setGuestCoupon(cart, null)) : accountChange({ action: "coupon", code: null, version: get().version!, requestId: globalThis.crypto.randomUUID() }),
      mergeGuest: async () => {
        try { const cart = guest.read(); if (!cart.lines.length || cart.pending.length || cart.ackPending) throw new Error("Finish pending guest checkout recovery before merging this cart."); return accountChange({ action: "merge", items: cart.lines.map(({ productId, quantity }) => ({ productId, quantity })), version: get().version!, requestId: globalThis.crypto.randomUUID() }, cart); }
        catch (error) { set({ error: message(error) }); return false; }
      },
      discardGuest: async () => {
        try { const cart = guest.read(); if (cart.pending.length || cart.ackPending) throw new Error("Finish the pending guest receipt before discarding its items."); await changeGuest(clearGuestItems, cart); if (syncScope() === "guest") await load(); return true; }
        catch (error) { set({ error: message(error) }); return false; }
      },
      previewLegacy: (indices) => legacyWork(async (scope, captured, signal) => {
        const snapshot = legacy.read();
        if (snapshot.summary.invalid || !indices.length || indices.length > 100) throw new Error("Review up to 100 saved rows at a time.");
        const selected = indices.map((index) => snapshot.summary.rows[index]).filter((row) => row?.productId);
        const ids = [...new Set(selected.map((row) => row.productId!))];
        const data = ids.length ? await request("/api/cart/guest", { method: "POST", signal, body: JSON.stringify({ lines: ids.map((productId) => ({ productId, lineId: globalThis.crypto.randomUUID(), quantity: 1 })) }) }, scope) : { lines: [] };
        legacy.matches(snapshot);
        if (!current(scope, captured) || signal.aborted) return false;
        set({ legacy: snapshot.summary, legacyProducts: Object.fromEntries((data.lines as CartViewLine[]).map((line) => [line.id, line.product])) }); return true;
      }),
      importLegacy: (indices, includeCoupon = false) => legacyWork(async (scope, captured, signal) => {
        const snapshot = legacy.read(), selected = legacy.importable(snapshot, indices), cart = guest.read();
        if (cart.pending.length || cart.ackPending) throw new Error("Finish the current guest checkout before restoring older browser rows.");
        if (includeCoupon && snapshot.summary.couponCode && cart.couponCode && cart.couponCode !== snapshot.summary.couponCode) throw new Error("Guest cart already has a different requested coupon. Review it before importing the older code.");
        const ids = [...new Set(selected.map((row) => row.productId))];
        const data = await request("/api/cart/guest", { method: "POST", signal, body: JSON.stringify({ lines: ids.map((productId) => ({ productId, lineId: globalThis.crypto.randomUUID(), quantity: 1 })) }) }, scope);
        if (!current(scope, captured) || signal.aborted) return false;
        const accepted: number[] = [];
        const saved = await guest.change(cart, (value) => {
          // Recheck both stores inside the guest write lock, after catalog I/O.
          // Separate-key cleanup follows; a failure retains safely repeatable
          // max-quantity rows instead of pretending localStorage is atomic.
          if (!current(scope, captured)) throw new Error("The active account changed. Review the older cart again.");
          legacy.matches(snapshot); let updated = value;
          for (const productId of ids) {
            const rows = selected.filter((row) => row.productId === productId), existing = updated.lines.find((line) => line.productId === productId);
            const quantity = Math.max(existing?.quantity ?? 0, ...rows.map((row) => row.quantity));
            const product = (data.lines as CartViewLine[]).find((line) => line.id === productId)?.product;
            if (!product || product.stock < quantity || (!existing && updated.lines.length >= 100)) continue;
            updated = setGuestQuantity(updated, productId, quantity); accepted.push(...rows.map((row) => row.index));
          }
          if (includeCoupon && accepted.length && snapshot.summary.couponCode && updated.couponCode === null) updated = setGuestCoupon(updated, snapshot.summary.couponCode);
          return updated;
        });
        publishGuest(saved.cart, saved.durable);
        if (!saved.durable) throw new Error("Restored rows are kept in this tab, but older storage was retained. Enable storage before completing this import.");
        if (!accepted.length) throw new Error("Selected products exceed current stock, are unavailable or do not fit. Their older rows were retained.");
        try { const remaining = await legacy.removeImportedRows(snapshot, accepted, includeCoupon); if (current(scope, captured)) set({ legacy: remaining.summary, legacyProducts: {} }); }
        catch { if (current(scope, captured)) set({ notice: "Guest rows were saved. Older cleanup could not be confirmed; refresh before retrying. Reimport uses larger quantities, without adding twice." }); return true; }
        broadcast("guest");
        if (current(scope, captured)) {
          set({ notice: `${accepted.length} older row(s) restored to the guest cart; ${selected.length - accepted.length} selected row(s) retained. Saving to an account requires a separate merge.` });
          if (scope === "guest") await load();
        }
        return true;
      }),
      repairLegacyQuantity: (index, quantity) => legacyWork(async (scope, captured) => {
        const result = await legacy.repairQuantity(legacy.read(), index, quantity);
        if (!current(scope, captured)) return false; set({ legacy: result.summary, legacyProducts: {} }); return true;
      }),
      recoverLegacyReceipt: (orderId) => legacyWork(async (scope, captured, signal) => {
        const snapshot = legacy.read();
        if (!snapshot.summary.pendingOrderIds.includes(orderId)) throw new Error("This older receipt needs manual review.");
        const data = await request(`/api/checkout/${orderId}`, { signal }, scope);
        if (!current(scope, captured) || signal.aborted) return false;
        if (data.order?.id !== orderId) throw new Error("The returned checkout receipt did not match this saved order.");
        const result = await legacy.settleReceipt(snapshot, data.order);
        if (!current(scope, captured)) return false;
        set({ legacy: result.summary, legacyProducts: {}, notice: "Older checkout receipt reviewed. Only verified matching line quantities were removed; review all retained rows and the requested coupon before import." }); return true;
      }),
      discardLegacy: () => legacyWork(async (scope, captured) => {
        const result = await legacy.discard(legacy.read());
        if (!current(scope, captured)) return false; set({ legacy: result.summary, legacyProducts: {}, notice: "Older browser cart cache discarded by your request." }); return true;
      }),
      getCheckoutContext: () => {
        if (!ready() || Object.keys(get().pendingCheckouts).length || get().items.some((item) => !item.available || (item.stock ?? 0) < item.quantity)) throw new Error("Refresh the cart and review availability before checkout.");
        if (syncScope() === "guest") {
          if (guest.isMemoryOnly()) throw new Error("Enable browser storage and save the guest cart before checkout, or sign in to use an account cart.");
          const cart = guest.read(), displayed = get().guestCart;
          if (!displayed || displayed.id !== cart.id || displayed.revision !== cart.revision) throw new Error("Guest cart changed in another tab. Refresh before checkout.");
          return guestCheckoutContext(cart);
        }
        const state = get();
        return cartCheckoutSchema.parse({ ownerId: state.scope.slice(8), sourceId: null, version: state.version, couponCode: state.couponCode, couponVersion: state.couponVersion, previousReceiptId: null, lines: state.items.map((item) => ({ productId: item.id, lineId: item.lineId, quantity: item.quantity })) });
      },
      rememberCheckout: async (orderId, _items, _coupon, context) => {
        if (!context) { set({ notice: "Review this older checkout's receipt; its cart lineage was not verified." }); return false; }
        if (context.ownerId !== null) { if (syncScope() === `account:${context.ownerId}`) await load(); return true; }
        try { const cart = guest.read(); if (cart.id !== context.sourceId) return false; const result = await guest.change(cart, (value) => rememberGuestReceipt(value, orderId, context)); publishGuest(result.cart, result.durable); broadcast("guest"); return true; }
        catch (error) { set({ error: message(error) }); return false; }
      },
      completeCheckout: (orderId, context) => settle(orderId, context, "purchased"),
      forgetCheckout: (orderId, context) => settle(orderId, context, "closed"),
      recoverCheckoutAttempt: async (silent = false) => {
        const scope = syncScope(), captured = epoch;
        if (scope === "loading" || get().busy) return false;
        try {
          const source = scope === "guest" ? { ownerId: null, sourceId: guest.read().id } : { ownerId: scope.slice(8), sourceId: null };
          const attempt = readCheckoutAttempt(source, deps.attemptStorage?.());
          if (!attempt || (scope === "guest" && (attempt.previousReceiptId ?? null) !== guest.read().previousReceiptId)) return false;
          const controller = new AbortController(); writer = controller; const timer = setTimeout(() => controller.abort(), 30_000);
          set({ busy: true });
          try {
            const data = await request("/api/checkout/attempt", { method: "POST", body: JSON.stringify({ checkoutToken: attempt.token, ...source }), signal: controller.signal }, scope);
            if (!current(scope, captured) || controller.signal.aborted) return false;
            const context = cartCheckoutSchema.parse(data.order?.cartSnapshot);
            z.string().uuid().parse(data.order?.id);
            if (context.ownerId !== source.ownerId || context.sourceId !== source.sourceId) throw new Error("Recovered receipt belongs to a different cart.");
            const order = data.order;
            bindCheckoutAttempt(attempt, order.id, deps.attemptStorage?.());
            set({ recentCheckout: { id: order.id, status: order.status, paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod, createdAt: order.createdAt ?? "" } });
            const closed = order.status === "CANCELLED" || order.paymentStatus === "FAILED";
            const confirmed = !closed && (order.paymentStatus === "PAID" || (order.paymentMethod === "COD" && ["PROCESSING", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(order.status)));
            let handled = false;
            if (closed) handled = await get().forgetCheckout(order.id, context);
            else if (confirmed) handled = await get().completeCheckout(order.id, context);
            else handled = await get().rememberCheckout(order.id, context.lines, context.couponCode, context);
            if ((closed || confirmed) && handled) clearCheckoutAttemptForOrder(order.id, deps.attemptStorage?.(), context);
            if (current(scope, captured)) set({ notice: "Original checkout receipt recovered. Review its status before placing another order." });
            return true;
          } finally { clearTimeout(timer); if (current(scope, captured)) set({ busy: false }); }
        } catch (error) { if (!silent && current(scope, captured)) set({ error: message(error) }); return false; }
      },
    };
  });
  return store;
}
