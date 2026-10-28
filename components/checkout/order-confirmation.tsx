"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatter";
import { useCartStore } from "@/stores/cart-store";
import { clearCheckoutAttemptForOrder } from "@/lib/checkout-attempt";

export type ConfirmedOrder = {
  id: string; total: number; status: string; paymentStatus: string; paymentMethod: string;
  trackingNumber: string | null; shippingAddress: string | null; canViewOrders: boolean; needsReview: boolean;
  items: { id: string; quantity: number; price: number; product: { name: string } }[];
};

export function OrderConfirmation({ initialOrder }: { initialOrder: ConfirmedOrder }) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pollingEnded, setPollingEnded] = useState(false);
  const manualRequest = useRef(false);
  const latestRequest = useRef(0);
  const completeCheckout = useCartStore((state) => state.completeCheckout);
  const forgetCheckout = useCartStore((state) => state.forgetCheckout);
  const pending = order.paymentMethod === "STRIPE" && order.paymentStatus === "UNPAID" && order.status !== "CANCELLED";
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++latestRequest.current;
    const response = await fetch(`/order-success/${initialOrder.id}/status`, { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to refresh your order.");
    if (!signal?.aborted && request === latestRequest.current) { setOrder(data.order); setError(""); }
    return data.order as ConfirmedOrder;
  }, [initialOrder.id]);

  useEffect(() => {
    if (order.status !== "CANCELLED" && (order.paymentStatus === "PAID" || order.paymentMethod === "COD")) completeCheckout(order.id);
    if (order.status === "CANCELLED" || order.paymentStatus === "FAILED") forgetCheckout(order.id);
    if (order.paymentStatus === "PAID" || order.status === "CANCELLED" || order.paymentStatus === "FAILED") clearCheckoutAttemptForOrder(order.id);
  }, [order.id, order.status, order.paymentStatus, order.paymentMethod, completeCheckout, forgetCheckout]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let remaining = 12;
    const poll = async () => {
      try {
        const current = await load(controller.signal);
        if (controller.signal.aborted) return;
        if (current.paymentStatus !== "UNPAID" || current.status === "CANCELLED") return;
        if (--remaining > 0) timer = setTimeout(poll, 5_000);
        else setPollingEnded(true);
      } catch (cause) {
        if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Unable to refresh your order."); setPollingEnded(true); }
      }
    };
    timer = setTimeout(poll, 5_000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending, load]);

  const refresh = async () => {
    if (manualRequest.current) return;
    manualRequest.current = true;
    setBusy(true);
    try { await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh your order."); }
    finally { manualRequest.current = false; setBusy(false); }
  };
  const cancelled = order.status === "CANCELLED";
  const failed = order.paymentStatus === "FAILED";
  const paid = order.paymentStatus === "PAID";
  const title = cancelled ? "Order cancelled" : failed ? "Payment failed" : paid ? "Payment confirmed" : order.paymentMethod === "COD" ? "Order received — pay on delivery" : "Awaiting payment confirmation";
  const amountLabel = cancelled && paid ? "Amount received — refund review" : cancelled || failed ? "Order total" : paid ? "Amount paid" : order.paymentMethod === "COD" ? "Amount due on delivery" : "Amount awaiting payment confirmation";

  return <section className="mx-auto my-12 max-w-2xl space-y-6 rounded-2xl border bg-card p-6 sm:p-8" aria-live="polite">
    <h1 className="text-2xl font-bold">{title}</h1>
    <p className="break-all">Order ID: {order.id}</p>
    {order.trackingNumber && <p>Tracking code: <strong>{order.trackingNumber}</strong></p>}
    <div className="space-y-2 rounded-xl bg-muted/30 p-4">
      <p>Delivery status: <strong>{order.status}</strong></p>
      <p>Payment status: <strong>{order.paymentStatus}</strong></p>
      <p>Payment method: {order.paymentMethod === "COD" ? "Cash on Delivery" : "Card (Stripe)"}</p>
      {order.shippingAddress && <p>Shipping address: {order.shippingAddress}</p>}
    </div>
    {pending && <p>We are waiting for server confirmation. Do not place another order. Your cart is retained until payment is verified.</p>}
    {cancelled && <p>This order will not be fulfilled. Your cart is retained.</p>}
    {failed && !cancelled && <p>Payment was not completed. Your cart is retained; check the saved checkout before trying again.</p>}
    {(order.needsReview || (cancelled && paid)) && <p role="status">{paid ? "Payment was received for a closed order. Contact support for refund review." : "Payment requires review. Check the saved checkout or contact support before placing another order."}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {pending && pollingEnded && <p>Automatic status checks have stopped. You can refresh this order explicitly.</p>}
    <ul className="divide-y border-y">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-4 py-3"><span>{item.product.name} × {item.quantity}</span><span>{formatCurrency(item.price * item.quantity)}</span></li>)}</ul>
    <p className="flex justify-between gap-4 font-bold"><span>{amountLabel}</span><span>{formatCurrency(order.total)}</span></p>
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="outline" disabled={busy} onClick={refresh}>{busy ? "Refreshing order…" : "Refresh order status"}</Button>
      {pending && <Link href={`/checkout?resume=${order.id}`} className="underline">Continue or review saved payment</Link>}
      <Link href="/track-order" className="underline">Track this order</Link>
      {order.canViewOrders && <Link href="/user/orders" className="underline">View my orders</Link>}
      <Link href="/products" className="underline">Continue shopping</Link>
    </div>
    {!order.canViewOrders && <p className="text-sm text-muted-foreground">For guest tracking, use the order ID or tracking code above and the phone number entered at checkout.</p>}
  </section>;
}
