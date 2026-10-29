"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { useWishlistStore, currentWishlistScope } from "@/stores/wishlist-store";
import { GUEST_WISHLIST_KEY, LEGACY_WISHLIST_KEY } from "@/lib/client/wishlist-controller";
export function WishlistSync() {
  const wishlist = useWishlistStore();
  useEffect(() => {
    const store = useWishlistStore.getState(); store.initialize();
    const updateScope = () => { const scope = currentWishlistScope(), previous = useWishlistStore.getState().scope; useWishlistStore.getState().setScope(scope); if (scope === previous && scope !== "loading") void useWishlistStore.getState().refresh(); };
    updateScope();
    const unsubscribe = useAuthStore.subscribe((state, previous) => { if (state.loading !== previous.loading || state.user?.id !== previous.user?.id) updateScope(); });
    if (useAuthStore.getState().loading) void useAuthStore.getState().fetchUser();
    const refresh = () => { if (document.visibilityState !== "hidden") void useWishlistStore.getState().refresh(); };
    const focus = () => { void useAuthStore.getState().fetchUser().then(refresh); };
    const storage = (event: StorageEvent) => { if ([GUEST_WISHLIST_KEY, LEGACY_WISHLIST_KEY, null].includes(event.key)) useWishlistStore.getState().syncBrowserStorage(); if (event.key === "amar_gadget_user" || event.key === null) void useAuthStore.getState().fetchUser(); };
    const interval = setInterval(() => { if (document.visibilityState !== "hidden") focus(); }, 30_000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus); window.addEventListener("storage", storage);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("amar-gadget-wishlist-v2");
    if (channel) channel.onmessage = (event: MessageEvent) => { if (`account:${event.data?.ownerId}` === useWishlistStore.getState().scope) refresh(); };
    return () => { unsubscribe(); clearInterval(interval); channel?.close(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); window.removeEventListener("storage", storage); useWishlistStore.getState().cancel(); };
  }, []);
  const pending = wishlist.legacyIds.length || wishlist.legacyInvalid || (wishlist.scope.startsWith("account:") && wishlist.guestIds.length);
  if (!pending && !wishlist.error && !wishlist.notice) return null;
  return <aside aria-label="Wishlist sync" className="border-b p-3 text-sm space-y-2">
    {wishlist.error && <p role="alert">{wishlist.error} <button type="button" disabled={wishlist.busy || wishlist.refreshing} onClick={() => void wishlist.refresh()} className="underline">Refresh wishlist</button></p>}
    {wishlist.notice && <p role="status">{wishlist.notice} <button type="button" onClick={wishlist.dismissNotice} className="underline">Dismiss wishlist notice</button></p>}
    {wishlist.scope.startsWith("account:") && wishlist.guestIds.length > 0 && <p>{wishlist.guestIds.length} guest item(s) remain in this browser. Merge only if you want them in this account. <button type="button" disabled={wishlist.busy || wishlist.status !== "ready"} onClick={() => void wishlist.mergeGuest()} className="underline">Merge guest wishlist into this account</button> <Link href="/wishlist" className="underline">View wishlist</Link></p>}
    {(wishlist.legacyIds.length > 0 || wishlist.legacyInvalid) && <p>Older browser wishlist data has no verified account owner and was not imported automatically. {wishlist.legacyInvalid ? "It is too large or malformed to import safely." : `${wishlist.legacyIds.length} older saved item(s) remain.`} <button type="button" disabled={wishlist.busy || wishlist.legacyInvalid || wishlist.guestIds.length >= 200} onClick={() => void wishlist.importLegacy()} className="underline">Import next older items into guest list</button> <button type="button" disabled={wishlist.busy} onClick={wishlist.discardLegacy} className="underline">Discard older browser wishlist</button></p>}
    {wishlist.guestIds.length > 0 && <button type="button" disabled={wishlist.busy} onClick={() => void wishlist.discardGuest()} className="underline">Discard browser guest wishlist</button>}
  </aside>;
}
