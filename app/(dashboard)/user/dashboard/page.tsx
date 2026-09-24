import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";

export default async function CustomerDashboardPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { name: true, imageUrl: true, slug: true } },
        },
      },
    },
    take: 10,
  });

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            Customer Dashboard
          </span>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">My Account & Orders</h1>
          <p className="text-xs text-muted-foreground">Track your electronics orders, view invoices, and manage saved items.</p>
        </div>

        <Link href="/products">
          <Button variant="default" className="font-bold text-xs">Browse Products</Button>
        </Link>
      </div>

      {/* Orders List */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">My Orders ({orders.length})</h2>

        {orders.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs space-y-3">
            <p>You haven't placed any orders yet.</p>
            <Link href="/products">
              <Button variant="outline" className="font-bold text-xs">Start Shopping</Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {orders.map((order) => (
              <div key={order.id} className="py-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
                  <div>
                    <span className="font-mono font-bold text-foreground">Order #{order.id.slice(0, 8)}</span>
                    <span className="text-muted-foreground ml-2">Tracking: {order.trackingNumber}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-emerald-600 font-bold bg-emerald-500/10 px-2.5 py-1 rounded uppercase">
                      {order.status}
                    </span>
                    <span className="font-extrabold text-foreground text-sm">{formatCurrency(Number(order.total))}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                  <span>Items:</span>
                  <span className="font-medium text-foreground">{order.items.map((i) => i.product.name).join(", ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}