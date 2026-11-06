"use client";

import React, { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCartStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchCheckoutQuote, useCheckoutQuote } from "@/hooks/use-checkout-quote";
import { productImageNeedsDirectDelivery } from "@/lib/product-media-policy";

const subscribeHydration = () => () => undefined;

export default function CartPage() {
  const scope = useCartStore((state) => state.scope);
  return <CartContent key={scope} />;
}
function CartContent() {
  const { items, removeItem, updateQuantity, clearCart, couponCode, applyCoupon, removeCoupon, pendingCheckouts, status, busy, refreshing, scope, version, catalogRevision, error, refresh: refreshCart, recentCheckout, guestCart, memoryOnly } = useCartStore();
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [applying, setApplying] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const ready = status === "ready" && !busy && !refreshing;

  const pendingOrderId = Object.keys(pendingCheckouts)[0];
  const lines = items.map((item) => ({ productId: item.id, quantity: item.quantity }));
  const { quote, error: quoteError, refresh } = useCheckoutQuote(lines, couponCode, "COD", hydrated && ready && !pendingOrderId && (scope !== "guest" || (!guestCart?.ackPending && !memoryOnly)) && items.every((item) => item.available && (item.stock ?? 0) >= item.quantity), `${scope}:${catalogRevision}`);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code || applying || !ready) return;
    setApplying(true);
    try {
      const checked = await fetchCheckoutQuote(lines, code);
      const latest = useCartStore.getState();
      if (latest.scope !== scope || latest.version !== version || latest.catalogRevision !== catalogRevision || latest.status !== "ready" || latest.busy || latest.refreshing || Object.keys(latest.pendingCheckouts).length || JSON.stringify(latest.items.map((item) => ({ productId: item.id, quantity: item.quantity }))) !== JSON.stringify(lines)) {
        setCouponMsg("Your cart changed. Apply the coupon again to check the updated items.");
        return;
      }
      if (await applyCoupon(code)) setCouponMsg(`Coupon ${code} applied: ${formatCurrency(checked.discountAmount)} discount.`);
    } catch (error) { setCouponMsg(error instanceof Error ? error.message : "Unable to validate coupon."); }
    finally { setApplying(false); }
  };

  if (!hydrated) return <p className="p-8">Loading cart…</p>;
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        <h1 className="text-3xl font-extrabold text-foreground mb-8">Shopping Cart</h1>
        <p className="mb-4">{scope === "guest" ? "Guest cart items stay in this browser. Sign in and explicitly merge to save them to an account." : "Your account cart syncs across sessions. Review current prices and stock before checkout."}</p>
        <button type="button" disabled={busy || refreshing || scope === "loading"} onClick={() => void refreshCart()} className="underline mb-4">Refresh current cart</button>
        {error && <p role="alert">{error}</p>}
        {(status === "loading" || refreshing) && <p role="status">Loading current cart...</p>}
        {pendingOrderId && <p className="border rounded p-4 my-4">A checkout is reserved for this cart. <Link className="underline" href={`/checkout?resume=${pendingOrderId}`}>Resume reserved checkout</Link>. Clearing items does not cancel an order.</p>}
        {recentCheckout && <p className="border rounded p-4 my-4">Recent checkout: <Link className="underline" href={recentCheckout.status === "PENDING" && recentCheckout.paymentStatus === "UNPAID" ? `/checkout?resume=${recentCheckout.id}` : `/order-success/${recentCheckout.id}`}>{recentCheckout.id}</Link>. Order status: {recentCheckout.status}; payment: {recentCheckout.paymentStatus}. Review this receipt before placing the same purchase again.</p>}

        {status === "ready" && items.length === 0 ? (
          <div className="text-center py-16 bg-card border border-border rounded-2xl p-8 space-y-4 shadow-sm">
            <div className="text-5xl">🛒</div>
            <h2 className="text-xl font-bold text-foreground">Your Shopping Cart is Empty</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Explore Bangladesh&apos;s electronics selection and add smartphones, laptops, and audio gear to your cart.
            </p>
            <Link href="/products">
              <Button variant="default" className="mt-4 font-bold px-6">
                Start Shopping
              </Button>
            </Link>
          </div>
        ) : items.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left 2 Cols: Cart Item Table */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center text-xs font-semibold text-muted-foreground uppercase">
                  <span>Product Items ({items.length})</span>
                  <button type="button" disabled={busy || refreshing} onClick={() => setClearConfirm(true)} className="text-destructive hover:underline">Clear All</button>
                </div>
                {clearConfirm && <p className="p-4">Remove these cart items and requested coupon? Pending checkout receipts are retained. <button type="button" disabled={busy} onClick={async () => { if (await clearCart()) setClearConfirm(false); }}>Confirm clear cart</button> <button type="button" disabled={busy} onClick={() => setClearConfirm(false)}>Keep cart</button></p>}

                <div className="divide-y divide-border">
                  {items.map((item) => {
                    const quotedLine = quote?.items.find((line) => line.productId === item.id);
                    return (
                      <div key={item.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center space-x-4 w-full sm:w-auto">
                          <div className="relative h-20 w-20 rounded-xl bg-muted/20 border border-border overflow-hidden shrink-0 flex items-center justify-center">
                            {item.imageUrl ? (
                              <Image src={item.imageUrl} unoptimized={productImageNeedsDirectDelivery(item.imageUrl)} alt={item.name} fill sizes="80px" className="object-contain p-2" />
                            ) : (
                              <span className="text-xs text-muted-foreground">No img</span>
                            )}
                          </div>
                          <div>
                            <Link href={`/products/${item.id}`} className="font-bold text-sm text-foreground hover:text-primary transition line-clamp-2">
                              {item.name}
                            </Link>
                            <div className="text-xs text-muted-foreground mt-1">
                              Price: <span className="font-semibold text-foreground">{quotedLine ? formatCurrency(quotedLine.unitPrice) : "—"}</span>
                            </div>
                            {!item.available && <p>This product is unavailable. Remove it before checkout.</p>}
                            {item.available && (item.stock ?? 0) < item.quantity && <p>Only {item.stock} currently available. Reduce quantity or remove this item.</p>}
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end space-x-6 w-full sm:w-auto">
                          {/* Quantity selector */}
                          <div className="flex items-center border border-border rounded-lg bg-background">
                            <button
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              disabled={busy || refreshing || item.quantity <= 1}
                              aria-label={`Decrease ${item.name} quantity`}
                              className="px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-muted rounded-l-lg"
                            >
                              -
                            </button>
                            <span className="px-3 text-xs font-bold">{item.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              disabled={!ready || !item.available || item.quantity >= Math.min(100, item.stock ?? 0)}
                              aria-label={`Increase ${item.name} quantity`}
                              className="px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-muted rounded-r-lg"
                            >
                              +
                            </button>
                          </div>

                          <span className="text-sm font-extrabold text-foreground min-w-20 text-right">
                            {quotedLine ? formatCurrency(quotedLine.lineTotal) : "—"}
                          </span>

                          <button
                            onClick={() => removeItem(item.id)}
                            disabled={busy || refreshing}
                            aria-label={`Remove ${item.name} from cart`}
                            className="text-muted-foreground hover:text-destructive text-sm"
                            title="Remove Item"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Coupon Redemption Bar */}
              <div className="bg-card border border-border p-4 rounded-xl space-y-2">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">Have a Promo Coupon?</span>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Enter coupon code"
                    disabled={applying || !ready || Boolean(pendingOrderId)}
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    className="max-w-xs text-xs"
                  />
                  <Button onClick={handleApplyCoupon} disabled={applying || !ready || Boolean(pendingOrderId)} variant="outline" className="text-xs font-bold">
                    Apply
                  </Button>
                </div>
                {couponMsg && <p className="text-xs font-medium text-primary mt-1">{couponMsg}</p>}
                {couponCode && <Button variant="outline" disabled={applying || !ready || Boolean(pendingOrderId)} onClick={async () => { if (await removeCoupon()) setCouponMsg(""); }}>Remove coupon {couponCode}</Button>}
              </div>
            </div>

            {/* Right Col: Summary Card */}
            <div className="space-y-4">
              <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
                <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">Order Summary</h2>
                {pendingOrderId && <p>Your reserved order has its own confirmed total. Resume it before starting another checkout.</p>}
                {quoteError && <p role="alert" className="text-destructive">{quoteError}</p>}
                {!quote && !pendingOrderId && <><p>Waiting for a current server total.</p><Button variant="outline" onClick={refresh}>Refresh total</Button></>}

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-semibold text-foreground">{quote ? formatCurrency(quote.subtotal) : "—"}</span>
                  </div>

                  {quote?.coupon && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Coupon Discount ({quote.coupon.code})</span>
                      <span>-{formatCurrency(quote.discountAmount)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-muted-foreground">
                    <span>Shipping Fee</span>
                    <span className="font-semibold text-foreground">
                      {quote ? (quote.shippingFee === 0 ? "FREE" : formatCurrency(quote.shippingFee)) : "—"}
                    </span>
                  </div>

                  <div className="border-t border-border pt-3 flex justify-between text-base font-extrabold text-foreground">
                    <span>Total</span>
                    <span className="text-primary">{quote ? formatCurrency(quote.total) : "—"}</span>
                  </div>
                </div>

                <Link href={pendingOrderId ? `/checkout?resume=${pendingOrderId}` : "/checkout"} className="block" aria-disabled={!quote && !pendingOrderId} onClick={(event) => { if (!quote && !pendingOrderId) event.preventDefault(); }}>
                  <Button variant="default" disabled={!quote && !pendingOrderId} className="w-full h-12 font-bold text-sm">
                    {pendingOrderId ? "Resume reserved checkout" : "Proceed to Checkout"}
                  </Button>
                </Link>

                <div className="text-[11px] text-center text-muted-foreground space-y-1">
                  <p>Prices and stock are confirmed by the server.</p>
                  <p>Cash on delivery and card checkout are available.</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
