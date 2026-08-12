"use client";

import React from "react";
import Link from "next/link";
import { useCartStore, useHydratedStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { H1, P } from "@/components/ui/typography";
import { ShoppingCart } from "@/components/icons/ShoppingCart";

export default function CartPage() {
  const rawItems = useHydratedStore(useCartStore, (state) => state.items);
  const cartItems = (rawItems || []) as Array<{ id: string; name: string; price: number; quantity: number }>;
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const clearCart = useCartStore((state) => state.clearCart);

  const subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const deliveryFee = subtotal > 0 ? 120 : 0;
  const grandTotal = subtotal + deliveryFee;

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-10">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <H1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Shopping Cart
          </H1>
          <P className="mt-2 text-muted-foreground text-sm">
            Review your selected gadgets before proceeding to checkout.
          </P>
        </div>
      </section>

      {/* Cart Content */}
      <section className="container mx-auto px-4 py-12 max-w-6xl">
        {cartItems.length === 0 ? (
          <div className="text-center py-16 px-4 bg-muted/20 rounded-2xl border border-dashed max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <ShoppingCart className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Your cart is empty</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Looks like you haven't added any gadgets to your cart yet.
            </p>
            <Link
              href="/products"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Explore Products
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Items List */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b">
                <span className="text-sm font-bold text-foreground">
                  Items ({cartItems.length})
                </span>
                <button
                  onClick={clearCart}
                  className="text-xs text-rose-500 hover:underline font-semibold cursor-pointer"
                >
                  Clear Cart
                </button>
              </div>

              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border border-border bg-card shadow-sm gap-4"
                >
                  <div className="space-y-1">
                    <h3 className="font-bold text-base text-foreground line-clamp-1">
                      {item.name}
                    </h3>
                    <p className="text-sm font-extrabold text-primary">
                      {formatCurrency(item.price)}
                    </p>
                  </div>

                  {/* Quantity Controls */}
                  <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-start">
                    <div className="flex items-center border border-border rounded-lg bg-muted/40 overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="px-3 py-1 text-sm font-bold hover:bg-muted transition-colors cursor-pointer"
                      >
                        -
                      </button>
                      <span className="px-3 text-xs font-bold font-mono">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="px-3 py-1 text-sm font-bold hover:bg-muted transition-colors cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-xs text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6 h-fit">
              <h3 className="text-lg font-bold text-foreground border-b pb-3">
                Order Summary
              </h3>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-semibold text-foreground">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Estimated Shipping (BD)</span>
                  <span className="font-semibold text-foreground">{formatCurrency(deliveryFee)}</span>
                </div>
                <div className="border-t pt-3 flex justify-between text-base font-extrabold text-foreground">
                  <span>Grand Total</span>
                  <span className="text-primary">{formatCurrency(grandTotal)}</span>
                </div>
              </div>

              <Link
                href="/checkout"
                className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
              >
                Proceed to Checkout
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}