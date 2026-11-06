import { create } from "zustand";
import { catalogIdSchema } from "@/lib/validations/product";
import { MAX_WISHLIST_ITEMS, type WishlistEntry, type WishlistSnapshotPage } from "@/lib/validations/wishlist";
export const GUEST_WISHLIST_KEY = "amar-gadget-wishlist-guest-v2";
export const LEGACY_WISHLIST_KEY = "amar-gadget-wishlist";
type Scope = "loading" | "guest" | `account:${string}`;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WishlistItem = { id: string; name?: string; price?: number; discountPrice?: number | null; imageUrl?: string | null; category?: string; brand?: string };
type Dependencies = { fetcher: typeof fetch; storage?: () => StorageLike | undefined; scopeNow?: () => Scope; lock?: <T>(work: () => Promise<T>) => Promise<T>; notify?: (ownerId: string) => void; accountChanged?: () => void };
export interface WishlistState {
  scope: Scope; items: WishlistEntry[]; guestIds: string[]; legacyIds: string[]; legacyInvalid: boolean;
  status: "loading" | "ready" | "error"; busy: boolean; refreshing: boolean; error: string; notice: string; version: number | null;
  initialize: () => void; setScope: (scope: Scope) => void; refresh: () => Promise<boolean>; syncBrowserStorage: () => void; cancel: () => void;
  addItem: (item: WishlistItem) => Promise<boolean>; removeItem: (id: string) => Promise<boolean>; clearWishlist: () => Promise<boolean>;
  isInWishlist: (id: string) => boolean; mergeGuest: () => Promise<boolean>; discardGuest: () => Promise<void>; importLegacy: () => Promise<void>; discardLegacy: () => void;
  dismissNotice: () => void;
}
export function createWishlistController(deps: Dependencies) {
  let epoch = 0, sequence = 0, reader: AbortController | undefined, writer: AbortController | undefined;
  const uniqueIds = (values: unknown[]) => [...new Set(values.flatMap((value) => { const parsed = catalogIdSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }))];
  const store = create<WishlistState>((set, get) => {
    const readGuest = () => {
      try { const storage = deps.storage?.(); if (!storage) return undefined; const raw = storage.getItem(GUEST_WISHLIST_KEY); if (!raw) return []; if (raw.length > 32_768) return undefined; const values: unknown = JSON.parse(raw); return Array.isArray(values) && values.length <= MAX_WISHLIST_ITEMS ? uniqueIds(values) : undefined; } catch { return undefined; }
    };
    const persistGuest = (ids: string[]) => { try { const storage = deps.storage?.(); if (!storage) return false; storage.setItem(GUEST_WISHLIST_KEY, JSON.stringify(ids)); return true; } catch { return false; } };
    const readLegacy = () => {
      try {
        const raw = deps.storage?.()?.getItem(LEGACY_WISHLIST_KEY); if (!raw) return { legacyIds: [], legacyInvalid: false };
        if (raw.length > 1_048_576) return { legacyIds: [], legacyInvalid: true };
        const data = JSON.parse(raw), rows: unknown = data?.state?.items;
        if (!Array.isArray(rows) || rows.length > 10_000) return { legacyIds: [], legacyInvalid: true };
        const ids = uniqueIds(rows.flatMap((row) => row && typeof row === "object" && "id" in row ? [row.id] : []));
        return { legacyIds: ids, legacyInvalid: rows.length > 0 && ids.length === 0 };
      } catch { return { legacyIds: [], legacyInvalid: true }; }
    };
    const locked = async <T,>(work: () => Promise<T>): Promise<T> => {
      if (!deps.lock) return work();
      let entered = false;
      try { return await deps.lock(() => { entered = true; return work(); }); }
      catch (error) { if (!entered) return work(); throw error; }
    };
    const scopeCurrent = () => { const scope = deps.scopeNow?.(); if (scope && scope !== get().scope) get().setScope(scope); return get().scope; };
    const current = (scope: Scope, captured: number) => captured === epoch && scope === scopeCurrent();
    async function json(url: string, init: RequestInit, scope: Scope) {
      const response = await deps.fetcher(url, { ...init, cache: "no-store", headers: { ...("body" in init ? { "Content-Type": "application/json" } : {}), ...(scope.startsWith("account:") ? { "X-Wishlist-Owner": scope.slice(8) } : {}) } });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.code === "ACCOUNT_CHANGED" && scope === get().scope) { set({ items: [], status: "error", version: null }); deps.accountChanged?.(); }
        throw new Error(data.message || "Wishlist request failed. Refresh before retrying.");
      }
      if (scope.startsWith("account:") && data.ownerId !== scope.slice(8)) throw new Error("The active account changed. Refresh your session.");
      return data;
    }
    async function load() {
      const scope = scopeCurrent(), captured = epoch;
      if (scope === "loading") return false;
      const token = ++sequence; reader?.abort(); const controller = new AbortController(); reader = controller;
      const timer = setTimeout(() => controller.abort(), 30_000);
      set({ refreshing: true, ...(get().status === "ready" ? {} : { status: "loading" as const }) });
      try {
        let items: WishlistEntry[] = [], version: number | null = null;
        if (scope === "guest") {
          const ids = [...get().guestIds];
          if (ids.length) items = (await json("/api/wishlist/guest", { method: "POST", body: JSON.stringify({ productIds: ids }), signal: controller.signal }, scope)).items;
        } else {
          // Each response is bounded. Legacy lists over the new creation cap
          // remain reachable; never publish a partial or mixed-version list.
          let stable = false;
          for (let retry = 0; retry < 3 && !stable; retry++) {
            items = []; version = null;
            for (let page = 1; ; page++) {
              const data: WishlistSnapshotPage = await json(`/api/wishlist?page=${page}`, { signal: controller.signal }, scope);
              if (version !== null && version !== data.version) break;
              version = data.version; items.push(...data.items);
              if (page >= data.totalPages) { stable = true; break; }
            }
          }
          if (!stable) throw new Error("Wishlist changed during sync. Refresh to load a consistent list.");
        }
        if (!controller.signal.aborted && token === sequence && current(scope, captured)) { set({ items, version, status: "ready", error: "" }); return true; }
      } catch (error) {
        if (token === sequence && current(scope, captured)) set({ items: [], status: "error", error: controller.signal.aborted ? "Wishlist sync timed out. Refresh to retry." : error instanceof Error ? error.message : "Wishlist sync failed." });
      } finally { clearTimeout(timer); if (token === sequence && current(scope, captured)) set({ refreshing: false }); }
      return false;
    }
    async function guestChange(transform: (ids: string[]) => string[]) {
      return locked(async () => {
        const ids = transform(readGuest() ?? get().guestIds);
        if (ids.length > MAX_WISHLIST_ITEMS) { set({ error: "Guest wishlist holds up to 200 items. Remove some before adding more." }); return false; }
        const persisted = persistGuest(ids); set({ guestIds: ids, notice: persisted ? "Guest wishlist saved in this browser." : "Wishlist is saved for this tab only; browser storage is unavailable." });
        return true;
      });
    }
    async function mutate(method: "POST" | "DELETE", body: unknown, consumeGuest = false) {
      const scope = scopeCurrent(), captured = epoch;
      if (scope === "loading" || get().busy || get().status !== "ready") { set({ error: "Wait for wishlist sync or refresh it before making another change." }); return false; }
      if (scope === "guest") return false;
      reader?.abort(); ++sequence; writer = new AbortController(); const controller = writer, timer = setTimeout(() => controller.abort(), 30_000);
      const guestSnapshot = [...get().guestIds]; set({ busy: true, refreshing: false, error: "", notice: "" });
      try {
        const data = await json("/api/wishlist", { method, body: JSON.stringify(body), signal: controller.signal }, scope);
        if (!current(scope, captured)) return false;
        if (consumeGuest) {
          const accepted = new Set<string>(data.acceptedIds);
          // The server merge is already committed. Browser cleanup failure
          // must not be reported as a failed server mutation.
          try { await locked(async () => { const remaining = (readGuest() ?? get().guestIds).filter((id) => !guestSnapshot.includes(id) || !accepted.has(id)); if (persistGuest(remaining)) set({ guestIds: remaining }); }); }
          catch { /* Guest IDs stay available; another merge is idempotent. */ }
        }
        if (!current(scope, captured)) return false;
        set({ notice: consumeGuest ? `Guest merge saved. ${data.skippedIds.length} unavailable item(s) skipped; ${get().guestIds.length} guest item(s) remain in this browser.` : "Wishlist change saved." });
        try { deps.notify?.(scope.slice(8)); } catch { /* Poll/focus sync still works; the server write is committed. */ }
        const loaded = await load();
        if (!loaded && current(scope, captured)) set({ notice: "Wishlist change was saved. Refresh to view the latest list." });
        return true;
      } catch (error) {
        if (current(scope, captured)) set({ error: controller.signal.aborted ? "Could not confirm this wishlist change. Refresh before retrying." : error instanceof Error ? error.message : "Could not confirm this wishlist change. Refresh before retrying." });
        return false;
      } finally { clearTimeout(timer); if (current(scope, captured)) set({ busy: false }); }
    }
    return {
      scope: "loading", items: [], guestIds: [], legacyIds: [], legacyInvalid: false, status: "loading", busy: false, refreshing: false, error: "", notice: "", version: null,
      initialize: () => set({ guestIds: readGuest() ?? get().guestIds, ...readLegacy() }),
      setScope: (scope) => { if (scope === get().scope) return; epoch++; sequence++; reader?.abort(); writer?.abort(); set({ scope, items: [], version: null, busy: false, refreshing: false, error: "", notice: "", status: "loading", guestIds: readGuest() ?? get().guestIds }); if (scope !== "loading") void load(); },
      refresh: async () => get().busy ? false : load(),
      syncBrowserStorage: () => { set({ guestIds: readGuest() ?? get().guestIds, ...readLegacy() }); if (get().scope === "guest") void load(); },
      cancel: () => { epoch++; sequence++; reader?.abort(); writer?.abort(); set({ busy: false, refreshing: false, status: "loading", items: [], version: null }); },
      isInWishlist: (id) => get().items.some((item) => item.id === id),
      dismissNotice: () => set({ notice: "" }),
      addItem: async (item) => {
        const parsed = catalogIdSchema.safeParse(item.id);
        if (!parsed.success) { set({ error: "Invalid product reference." }); return false; }
        if (scopeCurrent() !== "guest") return mutate("POST", { productIds: [parsed.data] });
        if (get().busy || get().status !== "ready") return false;
        set({ busy: true, error: "" }); try { const saved = await guestChange((ids) => [...new Set([...ids, parsed.data])]); if (saved) await load(); return saved; } finally { if (get().scope === "guest") set({ busy: false }); }
      },
      removeItem: async (id) => {
        if (scopeCurrent() !== "guest") return mutate("DELETE", { productIds: [id] });
        if (get().busy) return false; set({ busy: true, error: "" }); try { const saved = await guestChange((ids) => ids.filter((item) => item !== id)); if (saved) await load(); return saved; } finally { if (get().scope === "guest") set({ busy: false }); }
      },
      clearWishlist: async () => {
        if (scopeCurrent() !== "guest") return mutate("DELETE", { clear: true, version: get().version });
        if (get().busy) return false;
        await guestChange(() => []); await load(); return true;
      },
      mergeGuest: () => get().guestIds.length ? mutate("POST", { productIds: get().guestIds, merge: true }, true) : Promise.resolve(false),
      discardGuest: async () => { await guestChange(() => []); if (get().scope === "guest") await load(); },
      importLegacy: async () => {
        await locked(async () => {
          const ids = readGuest() ?? get().guestIds, selected = get().legacyIds.filter((id) => !ids.includes(id)).slice(0, MAX_WISHLIST_ITEMS - ids.length);
          if (!selected.length) { set({ error: "Remove or merge guest items before importing older browser items." }); return; }
          const remaining = get().legacyIds.filter((id) => !selected.includes(id) && !ids.includes(id));
          if (!persistGuest([...ids, ...selected])) { set({ error: "Browser storage is unavailable. Older items were retained." }); return; }
          try { const storage = deps.storage?.(); if (!storage) throw new Error(); if (remaining.length) storage.setItem(LEGACY_WISHLIST_KEY, JSON.stringify({ state: { items: remaining.map((id) => ({ id })) } })); else storage.removeItem(LEGACY_WISHLIST_KEY); }
          catch { set({ error: "Guest IDs were saved but older storage could not be updated. Refresh before importing again." }); }
          set({ guestIds: [...ids, ...selected], legacyIds: remaining, notice: "Older saved products moved to the guest wishlist. Merge explicitly to save them to an account." });
        }); if (get().scope === "guest") await load();
      },
      discardLegacy: () => { try { const storage = deps.storage?.(); if (!storage) throw new Error(); storage.removeItem(LEGACY_WISHLIST_KEY); set({ legacyIds: [], legacyInvalid: false }); } catch { set({ error: "Could not remove older browser storage." }); } },
    };
  });
  return store;
}
