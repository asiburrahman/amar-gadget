"use client";

import React, { useState } from "react";
import Link from "next/link";
import { H1, P } from "@/components/ui/typography";
import { FormInput } from "@/components/shared/form-input";
import { useCartStore, useHydratedStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";

export default function CheckoutPage() {
  const rawItems = useHydratedStore(useCartStore, (state) => state.items);
  const cartItems = (rawItems || []) as Array<{ id: string; name: string; price: number; quantity: number }>;
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cod" | "mfs">("card");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);

  const subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const deliveryFee = subtotal > 0 ? 120 : 0;
  const grandTotal = subtotal + deliveryFee;

  const handleOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setOrderComplete(true);
      useCartStore.getState().clearCart();
    }, 1500);
  };

  if (orderComplete) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center py-16 px-4">
        <div className="text-center max-w-md bg-card p-8 rounded-2xl border border-border shadow-lg space-y-4">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
            ✓
          </div>
          <h2 className="text-2xl font-extrabold text-foreground">Order Placed Successfully!</h2>
          <p className="text-sm text-muted-foreground">
            Thank you for shopping with Amar Gadget. We've sent an order confirmation to your email.
          </p>
          <Link
            href="/products"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-10">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <H1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Checkout
          </H1>
          <P className="mt-2 text-muted-foreground text-sm">
            Complete your shipping address and payment details below.
          </P>
        </div>
      </section>

      {/* Main Form */}
      <section className="container mx-auto px-4 py-12 max-w-6xl">
        <form onSubmit={handleOrderSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Shipping & Payment Info */}
          <div className="lg:col-span-2 space-y-8">
            {/* Customer Details */}
            <div className="bg-card p-6 rounded-2xl border border-border shadow-sm space-y-4">
              <h3 className="text-lg font-bold text-foreground border-b pb-3">
                1. Shipping Address
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput label="Full Name" placeholder="Rahim Uddin" required />
                <FormInput label="Phone Number" placeholder="+880 1700 000000" required />
                <div className="sm:col-span-2">
                  <FormInput label="Email Address" type="email" placeholder="rahim@example.com" required />
                </div>
                <div className="sm:col-span-2">
                  <FormInput label="Full Street Address" placeholder="House 42, Road 11, Banani, Dhaka" required />
                </div>
                <FormInput label="City" placeholder="Dhaka" required />
                <FormInput label="Postal Code" placeholder="1213" required />
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-card p-6 rounded-2xl border border-border shadow-sm space-y-4">
              <h3 className="text-lg font-bold text-foreground border-b pb-3">
                2. Payment Method
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("card")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    paymentMethod === "card"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="font-bold text-sm text-foreground">💳 Card</div>
                  <div className="text-xs text-muted-foreground mt-1">Visa / Mastercard / Amex</div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("mfs")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    paymentMethod === "mfs"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="font-bold text-sm text-foreground">📱 Mobile Banking</div>
                  <div className="text-xs text-muted-foreground mt-1">bKash / Nagad / Rocket</div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("cod")}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    paymentMethod === "cod"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="font-bold text-sm text-foreground">💵 Cash on Delivery</div>
                  <div className="text-xs text-muted-foreground mt-1">Pay when item arrives</div>
                </button>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm space-y-6 h-fit">
            <h3 className="text-lg font-bold text-foreground border-b pb-3">
              Order Summary
            </h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Items Subtotal</span>
                <span className="font-semibold text-foreground">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping Fee</span>
                <span className="font-semibold text-foreground">{formatCurrency(deliveryFee)}</span>
              </div>
              <div className="border-t pt-3 flex justify-between text-base font-extrabold text-foreground">
                <span>Total Amount</span>
                <span className="text-primary">{formatCurrency(grandTotal)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || cartItems.length === 0}
              className="w-full h-11 rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? "Processing Order..." : `Pay ${formatCurrency(grandTotal)}`}
            </button>
          </div>

        </form>
      </section>
    </div>
  );
}