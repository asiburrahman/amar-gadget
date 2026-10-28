"use client";

import React, { useState, useRef, useSyncExternalStore } from "react";
import { useCartStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOrder } from "@/server/actions/order/order-actions";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { getCheckoutAttempt, clearCheckoutAttempt, bindCheckoutAttempt, type CheckoutAttempt } from "@/lib/checkout-attempt";
import type { CheckoutDetails } from "@/lib/validations/order";
import { PaymentRecovery } from "@/components/checkout/payment-recovery";
import { useCheckoutQuote } from "@/hooks/use-checkout-quote";

const subscribeHydration = () => () => undefined;

export default function CheckoutForm() {
  const { items, couponCode, removeCoupon, rememberCheckout, completeCheckout, pendingCheckouts } = useCartStore();
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const attemptRef = useRef<CheckoutAttempt | undefined>(undefined);
  const submittingRef = useRef(false);

  const [formData, setFormData] = useState({
    fullName: null as string | null,
    phone: null as string | null,
    street: "",
    city: "",
    district: "",
    zipCode: "",
    paymentMethod: "COD" as "COD" | "STRIPE",
  });

  // Prefill untouched fields without an effect overwriting customer edits.
  const fullName = formData.fullName ?? user?.name ?? "";
  const phone = formData.phone ?? user?.phone ?? "";

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [canRestart, setCanRestart] = useState(false);

  const pendingOrderId = Object.keys(pendingCheckouts)[0];
  const { quote, error: quoteError, refresh: refreshQuote } = useCheckoutQuote(
    items.map((item) => ({ productId: item.id, quantity: item.quantity })), couponCode, formData.paymentMethod, hydrated && !pendingOrderId,
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0 || !quote || authLoading || submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);
    setErrorMsg("");
    setCanRestart(false);

    try {
      const cartSnapshot = items.map((item) => ({ productId: item.id, quantity: item.quantity, lineId: item.lineId }));
      const details: CheckoutDetails = {
        items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
        fullName,
        phone,
        street: formData.street,
        city: formData.city,
        district: formData.district,
        zipCode: formData.zipCode,
        paymentMethod: formData.paymentMethod,
        couponCode: couponCode || undefined,
      };
      const attempt = await getCheckoutAttempt(details, attemptRef.current);
      attemptRef.current = attempt;
      const result = await createOrder({ ...details, checkoutToken: attempt.token, quoteFingerprint: quote.fingerprint });

      if (result.success && result.orderId) {
        attemptRef.current = bindCheckoutAttempt(attempt, result.orderId);
        rememberCheckout(result.orderId, cartSnapshot, couponCode);
        if (formData.paymentMethod === "STRIPE" && result.paymentStatus !== "PAID") {
          router.push(`/checkout?resume=${result.orderId}`);
          return;
        }

        completeCheckout(result.orderId);
        clearCheckoutAttempt(attempt.token);
        router.push(`/order-success/${result.orderId}`);
      } else {
        setErrorMsg(result.error || "Order creation failed. Please check form inputs.");
        setCanRestart(result.code === "CHECKOUT_CLOSED" || result.code === "CHECKOUT_CONFLICT");
        if (result.code && ["QUOTE_CHANGED", "INVALID_COUPON", "COUPON_MIN_SPEND", "PRODUCT_UNAVAILABLE", "OUT_OF_STOCK", "INVALID_PRICE", "INVALID_TOTAL"].includes(result.code)) refreshQuote();
      }
    } catch {
      setErrorMsg("Checkout could not be completed. Retry with the same details to safely resume your order.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (!hydrated) return <p className="p-8">Loading checkout…</p>;
  if (pendingOrderId) return <PaymentRecovery orderId={pendingOrderId} />;
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 max-w-5xl">
        <h1 className="text-3xl font-extrabold text-foreground mb-8">Checkout & Shipping</h1>

        {items.length === 0 ? (
          <div className="text-center py-16 bg-card border border-border rounded-2xl p-8 space-y-4">
            <h2 className="text-xl font-bold">Your cart is empty</h2>
            <Button onClick={() => router.push("/products")} variant="default">Browse Products</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left 2 cols: Address & Payment Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Shipping Address Form */}
              <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
                <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">1. Shipping Address</h2>

                {errorMsg && (
                  <div className="p-3 text-xs font-semibold text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                    <p>{errorMsg}</p>
                    {canRestart && (
                      <button type="button" disabled={loading} className="mt-2 underline" onClick={() => {
                        if (attemptRef.current) clearCheckoutAttempt(attemptRef.current.token);
                        attemptRef.current = undefined;
                        setCanRestart(false);
                        setErrorMsg("Ready for a new checkout. Review your details and place the order again.");
                      }}>Start a new checkout</button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="font-semibold block mb-1">Full Name *</label>
                    <Input
                      required
                      name="fullName"
                      placeholder="e.g. Asibur Rahman"
                      value={fullName}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-1">Phone Number *</label>
                    <Input
                      required
                      name="phone"
                      placeholder="e.g. 01700000000"
                      value={phone}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="font-semibold block mb-1">Street Address *</label>
                    <Input
                      required
                      name="street"
                      placeholder="House, Road, Area details"
                      value={formData.street}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-1">City *</label>
                    <Input
                      required
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-1">District / Division *</label>
                    <Input
                      required
                      name="district"
                      value={formData.district}
                      onChange={handleChange}
                    />
                  </div>
                </div>
              </div>

              {/* Payment Method Option */}
              <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
                <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">2. Payment Method</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label
                    className={`p-4 rounded-xl border-2 flex items-start space-x-3 cursor-pointer transition ${formData.paymentMethod === "COD"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                      }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="COD"
                      checked={formData.paymentMethod === "COD"}
                      onChange={handleChange}
                      className="mt-1"
                    />
                    <div>
                      <span className="font-bold text-sm text-foreground block">Cash on Delivery (COD)</span>
                      <span className="text-xs text-muted-foreground">Pay in cash upon doorstep delivery anywhere in Bangladesh.</span>
                    </div>
                  </label>

                  <label
                    className={`p-4 rounded-xl border-2 flex items-start space-x-3 cursor-pointer transition ${formData.paymentMethod === "STRIPE"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                      }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="STRIPE"
                      checked={formData.paymentMethod === "STRIPE"}
                      onChange={handleChange}
                      className="mt-1"
                    />
                    <div>
                      <span className="font-bold text-sm text-foreground block">Credit / Debit Card (Stripe)</span>
                      <span className="text-xs text-muted-foreground">Instant secure card payment with 256-bit encryption.</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Right Col: Order Breakdown */}
            <div className="space-y-4">
              <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
                <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">Order Items ({items.length})</h2>
                {quoteError && <p role="alert" className="text-destructive">{quoteError}</p>}
                {!quote && !quoteError && <p>Calculating current prices…</p>}
                {!quote && <Button type="button" variant="outline" onClick={refreshQuote}>Refresh total</Button>}
                {couponCode && <Button type="button" variant="outline" onClick={removeCoupon}>Remove coupon {couponCode}</Button>}

                <div className="divide-y divide-border max-h-60 overflow-y-auto pr-1 space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="pt-2 flex justify-between text-xs">
                      <div>
                        <p className="font-bold text-foreground line-clamp-1">{item.name}</p>
                        <p className="text-muted-foreground">Qty: {item.quantity}</p>
                      </div>
                      <span className="font-semibold text-foreground">
                        {quote ? formatCurrency(quote.items.find((line) => line.productId === item.id)!.lineTotal) : "—"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-4 space-y-2 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-semibold text-foreground">{quote ? formatCurrency(quote.subtotal) : "—"}</span>
                  </div>
                  {quote?.coupon && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Discount ({quote.coupon.code})</span>
                      <span>-{formatCurrency(quote.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>Shipping</span>
                    <span className="font-semibold text-foreground">
                      {quote ? (quote.shippingFee === 0 ? "FREE" : formatCurrency(quote.shippingFee)) : "—"}
                    </span>
                  </div>
                  <div className="border-t border-border pt-3 flex justify-between text-base font-extrabold text-foreground">
                    <span>Total Amount</span>
                    <span className="text-primary">{quote ? formatCurrency(quote.total) : "—"}</span>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading || authLoading || !quote}
                  variant="default"
                  className="w-full h-12 font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {authLoading ? "Loading account..." : loading ? "Processing Order..." : formData.paymentMethod === "STRIPE" ? "Review Order & Continue to Payment" : "Confirm & Place Order"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
