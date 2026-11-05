import { createWishlistController } from "@/lib/client/wishlist-controller";
import { useAuthStore } from "@/stores/auth-store";
import { withBrowserLock } from "@/lib/client/browser-lock";
export type { WishlistItem } from "@/lib/client/wishlist-controller";
export function currentWishlistScope() {
  const { user, loading } = useAuthStore.getState();
  return loading ? "loading" as const : user?.id ? `account:${user.id}` as const : "guest" as const;
}
export const useWishlistStore = createWishlistController({
  fetcher: (...args) => fetch(...args),
  storage: () => { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } },
  scopeNow: currentWishlistScope,
  lock: (work) => withBrowserLock("amar-gadget-guest-wishlist", work),
  accountChanged: () => { void useAuthStore.getState().fetchUser(); },
  notify: (ownerId) => {
    if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("amar-gadget-wishlist-v2"); try { channel.postMessage({ ownerId }); } finally { channel.close(); } }
  },
});
