"use client";

import React, { useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";
import { updateOrderStatusByAdmin } from "@/server/actions/order/order-actions";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { AGGREGATE_ORDER_STATES, fulfillmentStatusLabel } from "@/lib/fulfillment-policy";
import { ShipmentEditor } from "@/components/orders/shipment-editor";

interface OrderItem {
  id: string;
  quantity: number;
  price: number;
  product: {
    id: string;
    name: string;
    imageUrl: string | null;
    price: number;
  };
}

interface Order {
  id: string;
  fulfillmentVersion: number;
  total: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  shippingAddress: string | null;
  trackingNumber: string | null;
  shippingCarrier: string | null;
  shipmentTrackingNumber: string | null;
  createdAt: string | Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  };
  items: OrderItem[];
}

interface Props {
  ownerId: string;
  initialOrders: Order[];
}

const STATUS_OPTIONS = AGGREGATE_ORDER_STATES;

export default function AdminOrdersClient(props: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading administrator account...</p>;
  if (!user || user.id !== props.ownerId || user.role !== "ADMIN") return <p>Reload the administrator area with the matching account.</p>;
  return <OwnedAdminOrdersClient key={props.ownerId + props.initialOrders.map((o) => o.id + ":" + o.fulfillmentVersion).join(",")} {...props} />;
}
function OwnedAdminOrdersClient({ initialOrders, ownerId }: Props) {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState("");
  const mutation = useRef(false);

  const handleStatusChange = (orderId: string, newStatus: string) => {
    if (mutation.current) return;
    mutation.current = true;
    setUpdatingId(orderId);
    setStatusError("");
    startTransition(async () => {
      try {
      const order = orders.find((row) => row.id === orderId);
      if (!order) return;
      const res = await updateOrderStatusByAdmin(orderId, newStatus, { ownerId, version: order.fulfillmentVersion });
      const actor = useAuthStore.getState().user;
      if (!actor || actor.id !== ownerId || actor.role !== "ADMIN") return;
      if (res.success) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: res.data?.status ?? o.status,
                  paymentStatus: res.data?.paymentStatus ?? o.paymentStatus,
                  fulfillmentVersion: res.data?.fulfillmentVersion ?? o.fulfillmentVersion,
                }
              : o
          )
        );
      } else setStatusError(res.error || "The order could not be updated.");
      router.refresh();
      } catch { if (useAuthStore.getState().user?.id === ownerId) setStatusError("The order change was not confirmed. Reload orders before retrying."); }
      finally { mutation.current = false; setUpdatingId(null); }
    });
  };

  const filteredOrders = orders.filter((order) => {
    if (statusFilter !== "ALL" && order.status !== statusFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchId = order.id.toLowerCase().includes(q);
      const matchTracking = order.trackingNumber?.toLowerCase().includes(q);
      const matchCustomer = order.user.name?.toLowerCase().includes(q) || order.user.email.toLowerCase().includes(q);
      const matchPhone = order.user.phone?.includes(q);
      const matchItem = order.items.some((i) => i.product.name.toLowerCase().includes(q));

      if (!matchId && !matchTracking && !matchCustomer && !matchPhone && !matchItem) {
        return false;
      }
    }

    return true;
  });

  const totalGrossRevenue = orders.reduce(
    (sum, order) => sum + (order.paymentStatus === "PAID" ? Number(order.total) : 0),
    0
  );
  const pendingCount = orders.filter((o) => o.status === "PENDING" || o.status === "PROCESSING").length;
  const deliveredCount = orders.filter((o) => o.status === "DELIVERED").length;

  return (
    <div className="space-y-6">
      {statusError && <p role="alert" className="text-destructive">{statusError} <button type="button" className="underline" onClick={() => router.refresh()}>Reload orders</button></p>}
      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border p-5 rounded-2xl shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">All Marketplace Orders</span>
          <p className="text-2xl font-extrabold text-foreground">{orders.length}</p>
          <span className="text-[11px] text-muted-foreground">Total order transactions</span>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Sales Revenue</span>
          <p className="text-2xl font-extrabold text-emerald-600">{formatCurrency(totalGrossRevenue)}</p>
          <span className="text-[11px] text-muted-foreground">Across all platform vendors</span>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Pending Fulfillment</span>
          <p className="text-2xl font-extrabold text-amber-500">{pendingCount}</p>
          <span className="text-[11px] text-muted-foreground">Require processing or shipping</span>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Completed / Delivered</span>
          <p className="text-2xl font-extrabold text-blue-600">{deliveredCount}</p>
          <span className="text-[11px] text-muted-foreground">Successfully fulfilled</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border shadow-xs">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              statusFilter === "ALL"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            All ({orders.length})
          </button>
          {STATUS_OPTIONS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === st
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {st} ({orders.filter((o) => o.status === st).length})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[280px]">
          <input
            type="text"
            placeholder="Search customer, tracking #, item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-input bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
            🔍
          </span>
        </div>
      </div>

      {/* Orders Table */}
      {filteredOrders.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center space-y-2">
          <div className="text-3xl">📦</div>
          <p className="font-bold text-foreground text-sm">No orders matching this criteria.</p>
          <p className="text-xs text-muted-foreground">Adjust filters or search parameters to view orders.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <th className="p-4">Order & Date</th>
                  <th className="p-4">Customer Details</th>
                  <th className="p-4">Items Ordered</th>
                  <th className="p-4">Total Amount</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4">Fulfillment Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOrders.map((order) => {
                  const dateStr = new Date(order.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                      {/* Order info */}
                      <td className="p-4 align-top">
                        <div className="font-mono font-bold text-foreground">
                          #{order.id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{dateStr}</div>
                        <ShipmentEditor orderId={order.id} carrier={order.shippingCarrier} trackingNumber={order.shipmentTrackingNumber} editable={["PROCESSING", "SHIPPED"].includes(order.status) && (order.paymentMethod === "COD" || order.paymentStatus === "PAID")} />
                        {order.trackingNumber && (
                          <div className="mt-1 font-mono text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded inline-block">
                            {order.trackingNumber}
                          </div>
                        )}
                      </td>

                      {/* Customer info */}
                      <td className="p-4 align-top">
                        <div className="font-bold text-foreground">{order.user.name || "Customer"}</div>
                        <div className="text-[11px] text-muted-foreground">{order.user.email}</div>
                        {order.user.phone && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">📞 {order.user.phone}</div>
                        )}
                      </td>

                      {/* Items */}
                      <td className="p-4 align-top">
                        <div className="space-y-1.5 max-w-[260px]">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex items-center gap-2">
                              {item.product.imageUrl ? (
                                <Image
                                  src={item.product.imageUrl}
                                  alt={item.product.name}
                                  width={24}
                                  height={24}
                                  unoptimized
                                  className="w-6 h-6 rounded object-cover border border-border shrink-0"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded bg-muted flex items-center justify-center text-[10px] shrink-0">
                                  📱
                                </div>
                              )}
                              <span className="truncate text-foreground font-medium text-[11px]">
                                {item.product.name} <strong className="text-muted-foreground">(×{item.quantity})</strong>
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Total */}
                      <td className="p-4 align-top">
                        <div className="font-extrabold text-foreground text-sm">
                          {formatCurrency(Number(order.total))}
                        </div>
                      </td>

                      {/* Payment */}
                      <td className="p-4 align-top">
                        <div className="font-bold uppercase text-[11px] text-foreground">
                          {order.paymentMethod}
                        </div>
                        <div className={`text-[10px] font-bold uppercase mt-0.5 ${order.paymentStatus === "PAID" ? "text-emerald-600" : "text-amber-500"}`}>
                          {order.paymentStatus}
                        </div>
                      </td>

                      {/* Fulfillment Status Select */}
                      <td className="p-4 align-top">
                        <select
                          value={order.status}
                          disabled={isPending || updatingId === order.id}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          className="h-8 px-2.5 rounded-lg border border-input bg-background text-xs font-semibold focus:ring-2 focus:ring-primary focus:outline-none cursor-pointer"
                        >
                          {[order.status, ...(order.status === "PENDING" && (order.paymentMethod === "COD" || order.paymentStatus === "PAID") ? ["PROCESSING"] : []), ...(["PENDING", "PROCESSING"].includes(order.status) && order.paymentStatus !== "PAID" ? ["CANCELLED"] : [])].map((st) => <option key={st} value={st}>{fulfillmentStatusLabel(st)}</option>)}
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="p-4 align-top text-right">
                        {order.trackingNumber && (
                          <Link href={`/track-order?id=${encodeURIComponent(order.trackingNumber)}`}>
                            <Button variant="outline" size="sm" className="h-7 text-[11px] font-bold">
                              Track
                            </Button>
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
