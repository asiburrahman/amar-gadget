import React from "react";
import Link from "next/link";
import { getOrderById } from "@/server/actions/order/order-actions";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getOrderById(id);

  if (!result.success || !result.data) {
    return (
      <div className="min-h-screen bg-background py-16 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Order Not Found</h1>
          <p className="text-sm text-muted-foreground">We couldn't retrieve the details for order ID: {id}</p>
          <Link href="/products">
            <Button variant="default">Back to Shop</Button>
          </Link>
        </div>
      </div>
    );
  }

  const order = result.data;

  return (
    <div className="min-h-screen bg-background py-16">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="bg-card border border-border p-8 rounded-2xl shadow-sm text-center space-y-6">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl font-extrabold">
            ✓
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground">Thank You For Your Order!</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Order ID: <span className="font-mono font-bold text-foreground">{order.id}</span> | Tracking: <span className="font-mono font-bold text-primary">{order.trackingNumber}</span>
            </p>
          </div>

          <div className="p-4 bg-muted/40 border border-border rounded-xl text-left text-xs space-y-2">
            <div className="flex justify-between font-bold text-foreground border-b border-border pb-2">
              <span>Delivery Status</span>
              <span className="text-emerald-600 uppercase">{order.status}</span>
            </div>
            <p className="text-muted-foreground">
              Shipping Address: <span className="font-medium text-foreground">{order.shippingAddress || "Standard Shipping"}</span>
            </p>
            <p className="text-muted-foreground">
              Payment Method: <span className="font-medium text-foreground">{order.paymentMethod === "COD" ? "Cash on Delivery" : "Card Payment (Stripe)"}</span> ({order.paymentStatus})
            </p>
          </div>

          {/* Ordered items breakdown */}
          <div className="text-left space-y-3">
            <h3 className="font-bold text-sm text-foreground">Items Ordered:</h3>
            <div className="divide-y divide-border border-t border-b border-border py-2 space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between text-xs pt-1">
                  <div>
                    <span className="font-semibold text-foreground">{item.product.name}</span>
                    <span className="text-muted-foreground ml-2">x{item.quantity}</span>
                  </div>
                  <span className="font-bold text-foreground">{formatCurrency(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-extrabold text-foreground pt-1">
              <span>Total Paid:</span>
              <span className="text-primary">{formatCurrency(order.total)}</span>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <Link href="/user/dashboard" className="flex-1">
              <Button variant="outline" className="w-full font-bold">
                View My Orders
              </Button>
            </Link>
            <Link href="/products" className="flex-1">
              <Button variant="default" className="w-full font-bold">
                Continue Shopping
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
