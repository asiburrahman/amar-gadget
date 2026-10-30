import { createCartController } from "@/lib/client/cart-controller";
import { useAuthStore } from "@/stores/auth-store";
export type { CartItem } from "@/lib/client/cart-controller";
export function currentCartScope() {
  const { user, loading } = useAuthStore.getState();
  return loading ? "loading" as const : user?.id ? `account:${user.id}` as const : "guest" as const;
}
export const useCartStore = createCartController({
  fetcher: (...args) => fetch(...args),
  storage: () => { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } },
  scopeNow: currentCartScope,
  lock: async (work) => typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request("amar-gadget-guest-cart-v3", work) : await work(),
  accountChanged: () => { void useAuthStore.getState().fetchUser(); },
  notify: (ownerId) => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("amar-gadget-cart-v3");
      try { channel.postMessage({ ownerId }); } finally { channel.close(); }
    }
  },
});
