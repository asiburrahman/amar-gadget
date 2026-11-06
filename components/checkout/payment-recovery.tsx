"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { clearCheckoutAttemptForOrder } from "@/lib/checkout-attempt";
import { cartCheckoutSchema } from "@/lib/validations/cart";

type CheckoutOrder = {
  id: string; total: number; status: string; paymentStatus: string; paymentMethod: string;
  shippingAddress: string | null; reservationExpiresAt: string | null; needsReview: boolean;
  items: { productId: string; name: string; quantity: number; price: number }[];
  cartSnapshot?: unknown;
};

export function PaymentRecovery({ orderId, compact = false }: { orderId: string; compact?: boolean }) {
  const router = useRouter();
  const completeCheckout = useCartStore((state) => state.completeCheckout);
  const forgetCheckout = useCartStore((state) => state.forgetCheckout);
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/checkout/${orderId}`, { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Unable to load checkout.");
    setOrder(data.order);
    setError("");
    const closed = data.order.status === "CANCELLED" || data.order.paymentStatus === "FAILED";
    const confirmed = !closed && (data.order.paymentStatus === "PAID" || (data.order.paymentMethod === "COD" && data.order.status !== "PENDING"));
    const handled = closed ? await forgetCheckout(orderId, data.order.cartSnapshot) : confirmed ? await completeCheckout(orderId, data.order.cartSnapshot) : false;
    if ((closed || confirmed) && handled) { const context = cartCheckoutSchema.safeParse(data.order.cartSnapshot); clearCheckoutAttemptForOrder(orderId, undefined, context.success ? context.data : null); }
    return data.order as CheckoutOrder;
  }, [orderId, completeCheckout, forgetCheckout]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let remaining = 12;
    const poll = async () => {
      try {
        const current = await load(controller.signal);
        if (current.paymentMethod === "STRIPE" && current.paymentStatus === "UNPAID" && current.status !== "CANCELLED" && --remaining > 0) timer = setTimeout(poll, 5_000);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load checkout.");
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);

  const act = async (action: "pay" | "cancel" | "refresh") => {
    if (requestRef.current) return;
    requestRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/checkout/${orderId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to confirm payment.");
      if (data.paid && !data.cancelled) {
        await load();
        router.push(`/order-success/${orderId}`);
      } else if (data.url) window.location.assign(data.url);
      else if (data.waiting) router.push(`/order-success/${orderId}`);
      else await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payment request failed. Retry this order; your cart is retained."); }
    finally { requestRef.current = false; setBusy(false); }
  };

  const paid = order?.paymentStatus === "PAID" && order.status !== "CANCELLED";
  const closed = order?.status === "CANCELLED" || order?.paymentStatus === "FAILED";
  return (
    <section className={compact ? "space-y-4" : "mx-auto max-w-3xl space-y-6 rounded-xl border p-6 my-10"} aria-live="polite">
      <h2 className="text-2xl font-bold">{paid ? "Payment confirmed" : closed ? "Checkout closed" : "Your reserved order"}</h2>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!order && !error && <p>Loading your order…</p>}
      {order && <>
        <p className="text-sm break-all">Order: {order.id}</p>
        <p>{paid ? "Payment is verified. Review your current cart before another purchase; later additions may remain." : closed ? "This order is closed. Your cart is retained." : "Your cart is retained while payment is pending. Continue payment for this same order."}</p>
        {order.needsReview && <p>{closed && order.paymentStatus === "PAID" ? "A payment was received for this closed order. Contact support for refund review; your cart is retained." : "Payment needs confirmation. Your reservation is retained; refresh the payment status or contact support before placing another order."}</p>}
        {!compact && <>
          <p>Shipping: {order.shippingAddress}</p>
          <ul className="space-y-2">{order.items.map((item) => <li key={item.productId}>{item.name} × {item.quantity} — {formatCurrency(item.price * item.quantity)}</li>)}</ul>
          <p className="font-bold">{paid ? "Amount paid" : "Order total"}: {formatCurrency(order.total)}</p>
          {order.reservationExpiresAt && !paid && !closed && <p className="text-sm">Reserved until {new Date(order.reservationExpiresAt).toLocaleString()}.</p>}
        </>}
        <div className="flex flex-wrap gap-3">
          {!paid && !closed && order.paymentMethod === "STRIPE" && <>
            <Button disabled={busy} onClick={() => act("pay")}>Continue secure card payment</Button>
            <Button variant="outline" disabled={busy} onClick={() => act("refresh")}>Refresh payment status</Button>
            <Button variant="outline" disabled={busy} onClick={() => act("cancel")}>Cancel reserved checkout</Button>
          </>}
          {closed && <Link href="/checkout" className="underline">Start a new checkout with your cart</Link>}
          {paid && <Link href={`/order-success/${orderId}`} className="underline">View order confirmation</Link>}
          <Link href="/cart" className="underline">View cart</Link>
        </div>
      </>}
      {error && <Button variant="outline" disabled={busy} onClick={() => { void load().catch((cause: Error) => setError(cause.message)); }}>Retry loading order</Button>}
    </section>
  );
}
