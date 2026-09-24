"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCartStore, useHydratedStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, couponCode, discountPercentage, applyCoupon } = useCartStore();
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState("");

  const subtotal = items.reduce((sum: number, item: any) => {
    const price = item.discountPrice || item.price;
    return sum + price * item.quantity;
  }, 0);

  const discountAmount = (subtotal * discountPercentage) / 100;
  const shippingFee = subtotal > 0 ? (subtotal > 50000 ? 0 : 150) : 0;
  const total = Math.max(0, subtotal - discountAmount + shippingFee);

  const handleApplyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    if (code === "AMAR10" || code === "WELCOME10") {
      applyCoupon(code, 10);
      setCouponMsg("✓ Coupon applied! 10% discount added.");
    } else if (code === "SUPER20") {
      applyCoupon(code, 20);
      setCouponMsg("✓ Coupon applied! 20% discount added.");
    } else {
      setCouponMsg("❌ Invalid coupon code. Try AMAR10");
    }
  };

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        <h1 className="text-3xl font-extrabold text-foreground mb-8">Shopping Cart</h1>

        {items.length === 0 ? (
          <div className="text-center py-16 bg-card border border-border rounded-2xl p-8 space-y-4 shadow-sm">
            <div className="text-5xl">🛒</div>
            <h2 className="text-xl font-bold text-foreground">Your Shopping Cart is Empty</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Explore Bangladesh's premier electronics selection and add flagship smartphones, laptops, audio gear to your cart.
            </p>
            <Link href="/products">
              <Button variant="default" className="mt-4 font-bold px-6">
                Start Shopping
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left 2 Cols: Cart Item Table */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center text-xs font-semibold text-muted-foreground uppercase">
                  <span>Product Items ({items.length})</span>
                  <button onClick={clearCart} className="text-destructive hover:underline">Clear All</button>
                </div>

                <div className="divide-y divide-border">
                  {items.map((item) => {
                    const effectivePrice = item.discountPrice || item.price;
                    return (
                      <div key={item.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center space-x-4 w-full sm:w-auto">
                          <div className="relative h-20 w-20 rounded-xl bg-muted/20 border border-border overflow-hidden shrink-0 flex items-center justify-center">
                            {item.imageUrl ? (
                              <Image src={item.imageUrl} alt={item.name} fill className="object-contain p-2" />
                            ) : (
                              <span className="text-xs text-muted-foreground">No img</span>
                            )}
                          </div>
                          <div>
                            <Link href={`/products/${item.id}`} className="font-bold text-sm text-foreground hover:text-primary transition line-clamp-2">
                              {item.name}
                            </Link>
                            <div className="text-xs text-muted-foreground mt-1">
                              Price: <span className="font-semibold text-foreground">{formatCurrency(effectivePrice)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end space-x-6 w-full sm:w-auto">
                          {/* Quantity selector */}
                          <div className="flex items-center border border-border rounded-lg bg-background">
                            <button
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              className="px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-muted rounded-l-lg"
                            >
                              -
                            </button>
                            <span className="px-3 text-xs font-bold">{item.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-muted rounded-r-lg"
                            >
                              +
                            </button>
                          </div>

                          <span className="text-sm font-extrabold text-foreground min-w-20 text-right">
                            {formatCurrency(effectivePrice * item.quantity)}
                          </span>

                          <button
                            onClick={() => removeItem(item.id)}
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
                    placeholder="Enter coupon (e.g. AMAR10)"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    className="max-w-xs text-xs"
                  />
                  <Button onClick={handleApplyCoupon} variant="outline" className="text-xs font-bold">
                    Apply
                  </Button>
                </div>
                {couponMsg && <p className="text-xs font-medium text-primary mt-1">{couponMsg}</p>}
              </div>
            </div>

            {/* Right Col: Summary Card */}
            <div className="space-y-4">
              <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
                <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">Order Summary</h2>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-semibold text-foreground">{formatCurrency(subtotal)}</span>
                  </div>

                  {couponCode && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Coupon Discount ({discountPercentage}%)</span>
                      <span>-{formatCurrency(discountAmount)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-muted-foreground">
                    <span>Shipping Fee</span>
                    <span className="font-semibold text-foreground">
                      {shippingFee === 0 ? <span className="text-emerald-600 font-bold">FREE</span> : formatCurrency(shippingFee)}
                    </span>
                  </div>

                  <div className="border-t border-border pt-3 flex justify-between text-base font-extrabold text-foreground">
                    <span>Total</span>
                    <span className="text-primary">{formatCurrency(total)}</span>
                  </div>
                </div>

                <Link href="/checkout" className="block">
                  <Button variant="default" className="w-full h-12 font-bold text-sm">
                    Proceed to Checkout
                  </Button>
                </Link>

                <div className="text-[11px] text-center text-muted-foreground space-y-1">
                  <p>🔒 256-Bit SSL Encrypted & Secure Checkout</p>
                  <p>✓ Cash on Delivery & Official Warranty Included</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}