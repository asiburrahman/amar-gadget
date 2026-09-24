"use client";

import React, { useState } from "react";
import { useCartStore, useHydratedStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOrder } from "@/server/actions/order/order-actions";
import { useRouter } from "next/navigation";

export default function CheckoutPage() {
  const { items, couponCode, discountPercentage, clearCart } = useCartStore();
  const router = useRouter();

  const [formData, setFormData] = useState({
    fullName: "Asibur Rahman",
    phone: "01700000000",
    street: "House 12, Road 5, Dhanmondi",
    city: "Dhaka",
    district: "Dhaka",
    zipCode: "1212",
    paymentMethod: "COD" as "COD" | "STRIPE",
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const subtotal = items.reduce((sum: number, item: any) => {
    const price = item.discountPrice || item.price;
    return sum + price * item.quantity;
  }, 0);

  const discountAmount = (subtotal * discountPercentage) / 100;
  const shippingFee = subtotal > 0 ? (subtotal > 50000 ? 0 : 150) : 0;
  const total = Math.max(0, subtotal - discountAmount + shippingFee);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const result = await createOrder(
        {
          items: items.map((i: any) => ({ productId: i.id, quantity: i.quantity })),
          fullName: formData.fullName,
          phone: formData.phone,
          street: formData.street,
          city: formData.city,
          district: formData.district,
          zipCode: formData.zipCode,
          paymentMethod: formData.paymentMethod,
          couponCode: couponCode || undefined,
        },
        "user-demo-id"
      );

      if (result.success && result.orderId) {
        if (formData.paymentMethod === "STRIPE") {
          const stripeRes = await fetch("/api/stripe/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items, orderId: result.orderId }),
          });
          const stripeData = await stripeRes.json();
          if (stripeData.success && stripeData.url) {
            clearCart();
            window.location.href = stripeData.url;
            return;
          }
        }

        clearCart();
        router.push(`/order-success/${result.orderId}`);
      } else {
        setErrorMsg(result.error || "Order creation failed. Please check form inputs.");
      }
    } catch (err: any) {
      setErrorMsg("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
                    {errorMsg}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="font-semibold block mb-1">Full Name *</label>
                    <Input
                      required
                      name="fullName"
                      placeholder="e.g. Asibur Rahman"
                      value={formData.fullName}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-1">Phone Number *</label>
                    <Input
                      required
                      name="phone"
                      placeholder="e.g. 01700000000"
                      value={formData.phone}
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

                <div className="divide-y divide-border max-h-60 overflow-y-auto pr-1 space-y-2">
                  {items.map((item: any) => (
                    <div key={item.id} className="pt-2 flex justify-between text-xs">
                      <div>
                        <p className="font-bold text-foreground line-clamp-1">{item.name}</p>
                        <p className="text-muted-foreground">Qty: {item.quantity}</p>
                      </div>
                      <span className="font-semibold text-foreground">
                        {formatCurrency((item.discountPrice || item.price) * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-4 space-y-2 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-semibold text-foreground">{formatCurrency(subtotal)}</span>
                  </div>
                  {couponCode && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Discount ({discountPercentage}%)</span>
                      <span>-{formatCurrency(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>Shipping</span>
                    <span className="font-semibold text-foreground">
                      {shippingFee === 0 ? <span className="text-emerald-600 font-bold">FREE</span> : formatCurrency(shippingFee)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-3 flex justify-between text-base font-extrabold text-foreground">
                    <span>Total Amount</span>
                    <span className="text-primary">{formatCurrency(total)}</span>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  variant="default"
                  className="w-full h-12 font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {loading ? "Processing Order..." : "Confirm & Place Order"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}