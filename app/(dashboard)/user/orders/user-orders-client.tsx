"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { CustomerShipments } from "@/components/orders/customer-shipments";
import type { CustomerFulfillment } from "@/lib/validations/fulfillment";
import { useAuth } from "@/hooks/use-auth";
import { RefundDetails } from "@/components/orders/refund-console";
import { RefundSummary, type RefundSummaryValue } from "@/components/orders/refund-summary";

interface OrderItem {
  id: string;
  quantity: number;
  price: number;
  product: {
    id: string;
    name: string;
    imageUrl: string | null;
    slug: string;
  };
}

interface Order extends RefundSummaryValue {
  id: string;
  total: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  shippingAddress: string | null;
  trackingNumber: string | null;
  createdAt: string | Date;
  items: OrderItem[];
  fulfillments?: CustomerFulfillment[];
}

interface Props {
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  initialOrders: Order[];
  query: { q: string; status: "ALL" | "ACTIVE" | "DELIVERED" | "CANCELLED" };
  counts: Record<"ALL" | "ACTIVE" | "DELIVERED" | "CANCELLED", number>;
}

export default function UserOrdersClient(props: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading your account...</p>;
  if (!user || user.id !== props.user.id) return <p>Reload your order history with the matching account.</p>;
  return <OwnedUserOrdersClient key={user.id} {...props} />;
}
function OwnedUserOrdersClient({ initialOrders, query, counts }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyTracking = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedId(num);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      DELIVERED: {
        label: "Delivered",
        className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      },
      SHIPPED: {
        label: "In Transit / Shipped",
        className: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      },
      PARTIALLY_SHIPPED: { label: "Partially shipped", className: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
      PARTIALLY_DELIVERED: { label: "Partially delivered", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
      PROCESSING: {
        label: "Processing Order",
        className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      },
      PENDING: {
        label: "Pending Confirmation",
        className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      },
      CANCELLED: {
        label: "Cancelled",
        className: "bg-destructive/10 text-destructive border-destructive/20",
      },
    };
    const s = map[status] || {
      label: status,
      className: "bg-muted text-muted-foreground border-border",
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wider ${s.className}`}>
        {s.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <form action="/user/orders" method="GET" className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <label>Search order ID, tracking or purchased item
          <input type="search" name="q" maxLength={120} defaultValue={query.q} className="block rounded border px-3 py-2" />
        </label>
        <label>Order status
          <select name="status" defaultValue={query.status} className="block rounded border px-3 py-2">
            <option value="ALL">All orders ({counts.ALL})</option>
            <option value="ACTIVE">Active ({counts.ACTIVE})</option>
            <option value="DELIVERED">Delivered ({counts.DELIVERED})</option>
            <option value="CANCELLED">Cancelled ({counts.CANCELLED})</option>
          </select>
        </label>
        <button type="submit" className="rounded border px-3 py-2">Apply order filters</button>
        <Link href="/user/orders" className="underline">Reset filters</Link>
        <p className="w-full text-xs text-muted-foreground">Search and status counts cover your whole matching order history.</p>
      </form>

      {/* Orders List */}
      {initialOrders.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center space-y-3">
          <div className="text-4xl">📦</div>
          <h3 className="font-bold text-foreground text-sm">No orders found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {query.q
              ? `No orders matching "${query.q}" in this view.`
              : "You haven't placed any orders in this category yet."}
          </p>
          <div className="pt-2">
            <Link href="/products">
              <Button variant="default" className="text-xs font-bold">
                Shop Gadgets Now
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {initialOrders.map((order) => {
            const dateStr = new Date(order.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={order.id}
                className="bg-card border border-border rounded-2xl shadow-xs overflow-hidden transition-all hover:border-primary/40"
              >
                {/* Order Top Header */}
                <div className="p-4 sm:p-5 bg-muted/40 border-b border-border flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono font-bold text-foreground bg-background px-2.5 py-1 rounded-md border border-border shadow-2xs">
                      #{order.id.slice(0, 8)}
                    </span>
                    <span className="text-muted-foreground text-[11px]">{dateStr}</span>
                    {order.trackingNumber && (
                      <div className="flex items-center gap-1.5 bg-background px-2.5 py-1 rounded-md border border-border text-[11px]">
                        <span className="text-muted-foreground">Tracking:</span>
                        <strong className="font-mono text-foreground">{order.trackingNumber}</strong>
                        <button
                          type="button"
                          onClick={() => copyTracking(order.trackingNumber!)}
                          className="text-primary hover:underline font-bold text-[10px] ml-1 cursor-pointer"
                          title="Copy tracking number"
                        >
                          {copiedId === order.trackingNumber ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {getStatusBadge(order.status)}
                    <span className="text-xs font-bold text-muted-foreground uppercase bg-background px-2 py-0.5 rounded border border-border">
                      {order.paymentMethod} • {order.paymentStatus}
                    </span>
                  </div>
                </div>

                {/* Items in Order */}
                <div className="p-4 sm:p-5 divide-y divide-border/60">
                  {order.items.map((item) => (
                    <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-3.5">
                        {item.product.imageUrl ? (
                          <Image unoptimized width={48} height={48}
                            src={item.product.imageUrl}
                            alt={item.product.name}
                            className="w-12 h-12 rounded-xl object-cover border border-border shrink-0 bg-muted"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center text-lg shrink-0">
                            📱
                          </div>
                        )}
                        <div>
                          <Link
                            href={`/products/${item.product.slug}`}
                            className="font-bold text-foreground hover:text-primary transition-colors line-clamp-1"
                          >
                            {item.product.name}
                          </Link>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            Qty: <strong className="text-foreground">{item.quantity}</strong> × {formatCurrency(Number(item.price))}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-extrabold text-foreground text-sm">
                          {formatCurrency(Number(item.price) * item.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Order Footer */}
                <CustomerShipments shipments={order.fulfillments} items={order.items} />
                <RefundSummary {...order} />
                <RefundDetails orderId={order.id} />
                <div className="p-4 sm:p-5 bg-muted/20 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="text-muted-foreground text-[11px]">
                    {order.shippingAddress && (
                      <span>📍 Shipping to: <strong className="text-foreground">{order.shippingAddress}</strong></span>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    <div className="text-right">
                      <span className="text-[11px] text-muted-foreground mr-2">Grand Total:</span>
                      <span className="font-extrabold text-lg text-foreground">
                        {formatCurrency(Number(order.total))}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {order.trackingNumber && (
                        <Link href={`/track-order?id=${order.trackingNumber}`}>
                          <Button variant="default" size="sm" className="font-bold text-xs h-8">
                            Track Order
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
