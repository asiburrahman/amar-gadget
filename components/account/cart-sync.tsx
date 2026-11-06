"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { currentCartScope, useCartStore } from "@/stores/cart-store";
import { GUEST_CART_KEY, LEGACY_CART_KEY } from "@/lib/client/guest-cart";

export function CartSync() {
  const scope = useCartStore((state) => state.scope);
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (alive && document.visibilityState !== "hidden") void useCartStore.getState().refresh(); };
    const changeScope = () => {
      const next = currentCartScope(); useCartStore.getState().setScope(next);
      if (next !== "loading") void useCartStore.getState().refresh().then(() => { if (alive && currentCartScope() === next) void useCartStore.getState().recoverCheckoutAttempt(true); });
    };
    changeScope();
    void useCartStore.getState().initialize().then(() => { if (alive) { refresh(); void useCartStore.getState().recoverCheckoutAttempt(true); } });
    const unsubscribe = useAuthStore.subscribe((state, previous) => { if (state.loading !== previous.loading || state.user?.id !== previous.user?.id) changeScope(); });
    const focus = () => { if (document.visibilityState !== "hidden") void useAuthStore.getState().fetchUser().then(refresh); };
    const storage = (event: StorageEvent) => {
      if ([GUEST_CART_KEY, LEGACY_CART_KEY, null].includes(event.key)) void useCartStore.getState().syncBrowserStorage();
      if (event.key === "amar_gadget_user" || event.key === null) void useAuthStore.getState().fetchUser();
    };
    const interval = setInterval(focus, 30_000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus); window.addEventListener("storage", storage);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("amar-gadget-cart-v3");
    if (channel) channel.onmessage = (event: MessageEvent) => {
      const active = useCartStore.getState().scope;
      if (event.data?.ownerId === null) void useCartStore.getState().syncBrowserStorage();
      else if (active === `account:${event.data?.ownerId}`) refresh();
    };
    return () => { alive = false; unsubscribe(); clearInterval(interval); channel?.close(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); window.removeEventListener("storage", storage); useCartStore.getState().cancel(); };
  }, []);
  return <CartSyncMessages key={scope} />;
}
function CartSyncMessages() {
  const cart = useCartStore();
  const [review, setReview] = useState(false), [discard, setDiscard] = useState(false), [discardGuest, setDiscardGuest] = useState(false);
  const guestCount = cart.guestCart?.lines.length ?? 0, guestPending = cart.guestCart?.pending.length || cart.guestCart?.ackPending;
  if (!cart.error && !cart.notice && !cart.memoryOnly && !cart.legacy.present && !(cart.scope.startsWith("account:") && (guestCount || guestPending))) return null;
  return <aside aria-label="Cart sync" className="border-b p-3 text-sm space-y-3">
    {cart.error && <p role="alert">{cart.error} <button type="button" disabled={cart.busy || cart.refreshing} onClick={() => void cart.refresh()} className="underline">Refresh cart</button> <button type="button" disabled={cart.busy} onClick={() => void cart.recoverCheckoutAttempt()} className="underline">Recover original checkout</button></p>}
    {cart.notice && <p role="status">{cart.notice} <button type="button" onClick={cart.dismissNotice} className="underline">Dismiss cart notice</button></p>}
    {cart.memoryOnly && <p>Guest cart changes are kept in this tab. Keep it open and enable browser storage for recovery. <button type="button" disabled={cart.busy} onClick={() => void cart.retryStorage()} className="underline">Retry saving guest cart</button></p>}
    {cart.scope.startsWith("account:") && (guestCount > 0 || guestPending) && <div className="space-y-2"><p>{guestCount} guest product(s) remain separate in this browser. Merge only items intended for this account. For an existing product, the larger quantity is kept. The account coupon stays unchanged.</p>
      {guestPending ? <p>A guest checkout receipt needs review in its original guest session before merging or discarding these items. <Link href={`/checkout?resume=${cart.guestCart?.ackPending?.orderId ?? cart.guestCart?.pending[0]?.orderId}`} className="underline">Open guest receipt</Link></p> : <><button type="button" disabled={cart.busy || cart.status !== "ready" || cart.refreshing} onClick={() => void cart.mergeGuest()} className="underline">Merge guest cart into this account</button> <button type="button" disabled={cart.busy} onClick={() => setDiscardGuest(true)} className="underline">Discard guest items</button></>}
      {discardGuest && <p>Remove these guest items from this browser? <button type="button" disabled={cart.busy} onClick={async () => { if (await cart.discardGuest()) setDiscardGuest(false); }}>Confirm discard guest items</button> <button type="button" onClick={() => setDiscardGuest(false)}>Keep guest items</button></p>}
    </div>}
    {cart.legacy.present && <div className="space-y-2"><p>Older browser cart data has no verified account owner. It has not been imported automatically. {cart.legacy.invalid ? "Malformed or oversized data was retained for review." : `${cart.legacy.totalRows} older row(s) remain.`}</p>
      <button type="button" onClick={() => setReview(!review)} className="underline">{review ? "Close older cart review" : "Review older browser cart"}</button> <button type="button" disabled={cart.legacyBusy} onClick={() => setDiscard(true)} className="underline">Discard older browser cart</button>
      {discard && <p>Discard the entire older cache, including saved receipt references? Existing orders remain on the server; keep their order IDs before discarding. <button type="button" disabled={cart.legacyBusy} onClick={async () => { if (await cart.discardLegacy()) { setDiscard(false); setReview(false); } }}>Confirm discard older cache</button> <button type="button" onClick={() => setDiscard(false)}>Keep older cache</button></p>}
      {review && !cart.legacy.invalid && <LegacyCartReview />}
    </div>}
  </aside>;
}
function LegacyCartReview() {
  const cart = useCartStore();
  const [page, setPage] = useState(1), [selected, setSelected] = useState<number[]>([]), [coupon, setCoupon] = useState(false);
  const pages = Math.max(1, Math.ceil(cart.legacy.totalRows / 25)), currentPage = Math.min(page, pages), rows = cart.legacy.rows.slice((currentPage - 1) * 25, currentPage * 25);
  const blocked = cart.legacyBusy || cart.legacy.invalidPending || cart.legacy.pendingOrderIds.length > 0;
  return <section aria-label="Older cart review" className="border rounded p-3 space-y-3">
    <p>Review current product information before restoring rows to the guest cart. Cached names, prices and stock are ignored. Unavailable or overstock rows stay here. Restore up to 100 selected rows at a time.</p>
    {cart.legacy.invalidPending && <p role="alert">Some saved receipt references are malformed or exceed the review limit. They were retained. Review the original receipts before discarding this cache.</p>}
    {cart.legacy.pendingOrderIds.map((id) => <p key={id}>Older checkout: {id}. <Link href={`/checkout?resume=${id}`} className="underline">Resume or review checkout</Link> <button type="button" disabled={cart.legacyBusy} onClick={() => void cart.recoverLegacyReceipt(id)} className="underline">Verify completed receipt {id}</button></p>)}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={cart.legacyBusy} onClick={() => void cart.previewLegacy(rows.map((row) => row.index))}>Load current products for this page</button><button type="button" disabled={blocked} onClick={() => setSelected(rows.filter((row) => !row.problem).map((row) => row.index))}>Select valid rows on this page</button><button type="button" onClick={() => setSelected([])}>Clear selection</button></div>
    <ul className="space-y-3">{rows.map((row) => <li key={`${row.index}:${row.quantity}`} className="border-b pb-2">
      <label><input type="checkbox" disabled={!!row.problem || !!blocked} checked={selected.includes(row.index)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.index] : selected.filter((id) => id !== row.index))} /> Row {row.index + 1}: {row.productId ? <Link href={`/products/${row.productId}`} className="underline">{cart.legacyProducts[row.productId]?.name ?? row.productId}</Link> : "Invalid product reference"}; quantity {row.quantity ?? "needs correction"}</label>
      {row.productId && Object.hasOwn(cart.legacyProducts, row.productId) && <p>{cart.legacyProducts[row.productId] ? `Current stock: ${cart.legacyProducts[row.productId]!.stock}` : "Currently unavailable; this row will be retained."}</p>}
      {row.problem && <p>{row.problem}</p>}
      {row.productId && <form onSubmit={(event) => { event.preventDefault(); const value = Number(new FormData(event.currentTarget).get("quantity")); void cart.repairLegacyQuantity(row.index, value); }}><label>Reviewed quantity for row {row.index + 1} <input name="quantity" type="number" min={1} max={100} step={1} required defaultValue={row.quantity ?? ""} className="border rounded px-2 w-20" /></label> <button type="submit" disabled={cart.legacyBusy}>Save reviewed quantity</button></form>}
    </li>)}</ul>
    {cart.legacy.couponCode && <label><input type="checkbox" checked={coupon} onChange={(event) => setCoupon(event.target.checked)} /> Also restore requested coupon {cart.legacy.couponCode}; checkout validates its discount.</label>}
    <button type="button" disabled={!!blocked || !selected.length || selected.length > 100} onClick={async () => { if (await cart.importLegacy(selected, coupon)) setSelected([]); }}>Restore selected rows to guest cart</button>
    <nav aria-label="Older cart pages" className="flex gap-3"><button type="button" disabled={currentPage <= 1 || cart.legacyBusy} onClick={() => { setPage(currentPage - 1); setSelected([]); }}>Previous older rows</button><span>Page {currentPage} of {pages}</span><button type="button" disabled={currentPage >= pages || cart.legacyBusy} onClick={() => { setPage(currentPage + 1); setSelected([]); }}>Next older rows</button></nav>
  </section>;
}
