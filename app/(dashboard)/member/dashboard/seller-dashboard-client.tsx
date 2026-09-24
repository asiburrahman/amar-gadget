"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/formatter";
import { updateOrderStatusBySeller } from "@/server/actions/order/order-actions";

interface ProductItem {
  id: string;
  name: string;
  price: number;
  stock: number;
  status: string;
  createdAt: Date | string;
  imageUrl?: string | null;
  category?: { name: string } | null;
}

interface OrderItemData {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: number;
  createdAt: string;
  product: {
    id: string;
    name: string;
    imageUrl?: string | null;
    price: number;
  };
  order: {
    id: string;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    shippingAddress?: string | null;
    trackingNumber?: string | null;
    createdAt: string;
    user: {
      name: string | null;
      email: string;
      phone: string | null;
    };
  };
}

interface SellerDashboardClientProps {
  seller: {
    id: string;
    name: string | null;
    email: string;
    sellerStatus: string;
  } | null;
  products: ProductItem[];
  orderItems: OrderItemData[];
}

export default function SellerDashboardClient({
  seller,
  products,
  orderItems: initialOrderItems,
}: SellerDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<"ALL" | "APPROVED" | "PENDING">("ALL");
  const [activeMainTab, setActiveMainTab] = useState<"ORDERS" | "CATALOG" | "ANALYTICS">("ORDERS");
  const [orderItems, setOrderItems] = useState<OrderItemData[]>(initialOrderItems);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const sellerStatus = seller?.sellerStatus || "PENDING";
  const isApproved = sellerStatus === "APPROVED";
  const isBlocked = sellerStatus === "BLOCKED";
  const isPending = sellerStatus === "PENDING";

  // Financial Analytics Calculations
  const totalUnitsSold = orderItems.reduce((acc, item) => acc + item.quantity, 0);
  const totalRevenue = orderItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

  const deliveredEarnings = orderItems
    .filter((item) => item.order.status === "DELIVERED")
    .reduce((acc, item) => acc + item.price * item.quantity, 0);

  const pendingDeliveryCount = orderItems.filter(
    (item) => item.order.status !== "DELIVERED" && item.order.status !== "CANCELLED"
  ).length;

  // Month-wise Sales Breakdown calculation
  const monthlyDataMap: Record<
    string,
    { monthLabel: string; totalRevenue: number; deliveredEarnings: number; ordersCount: number }
  > = {};

  orderItems.forEach((item) => {
    const dateObj = new Date(item.createdAt);
    const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;
    const monthLabel = dateObj.toLocaleString("en-US", { month: "long", year: "numeric" });

    if (!monthlyDataMap[monthKey]) {
      monthlyDataMap[monthKey] = { monthLabel, totalRevenue: 0, deliveredEarnings: 0, ordersCount: 0 };
    }

    const itemTotal = item.price * item.quantity;
    monthlyDataMap[monthKey].totalRevenue += itemTotal;
    monthlyDataMap[monthKey].ordersCount += 1;

    if (item.order.status === "DELIVERED") {
      monthlyDataMap[monthKey].deliveredEarnings += itemTotal;
    }
  });

  const monthlyAnalytics = Object.keys(monthlyDataMap)
    .sort()
    .reverse()
    .map((key) => monthlyDataMap[key]);

  // Product counts
  const totalProducts = products.length;
  const approvedProducts = products.filter((p) => p.status === "APPROVED");
  const pendingProducts = products.filter((p) => p.status === "PENDING_APPROVAL");

  const displayedProducts =
    activeTab === "APPROVED"
      ? approvedProducts
      : activeTab === "PENDING"
      ? pendingProducts
      : products;

  // Handler for Seller updating Order Status
  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    if (!seller) return;
    setUpdatingOrderId(orderId);
    setMsg("");

    try {
      const result = await updateOrderStatusBySeller(orderId, newStatus, seller.id);
      if (result.success) {
        setOrderItems((prev) =>
          prev.map((item) =>
            item.order.id === orderId
              ? {
                  ...item,
                  order: {
                    ...item.order,
                    status: newStatus,
                    paymentStatus: newStatus === "DELIVERED" ? "PAID" : item.order.paymentStatus,
                  },
                }
              : item
          )
        );
        setMsg(`✓ Order ${newStatus === "DELIVERED" ? "marked as Delivered! Earnings credited." : "updated to " + newStatus}`);
      } else {
        setMsg(`❌ ${result.error || "Failed to update order"}`);
      }
    } catch (err) {
      setMsg("❌ An error occurred updating status.");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Seller Account Status Alert Banners */}
      {isPending && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⏳</span>
            <span>Seller Account Pending Admin Approval</span>
          </div>
          <p className="text-xs">
            Your seller account is currently under moderation review by the Super Admin. You cannot publish new products until your account is approved.
          </p>
        </div>
      )}

      {isBlocked && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⛔</span>
            <span>Seller Account Suspended / Blocked</span>
          </div>
          <p className="text-xs">
            Your vendor permissions have been temporarily restricted by the Admin. Product creation and storefront listings are hidden and disabled.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            Vendor Portal
          </span>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">Seller Dashboard & Sales Center</h1>
          <p className="text-xs text-muted-foreground">
            Monitor sales earnings, process customer orders, track monthly revenue, and manage store catalog.
          </p>
        </div>

        <div className="flex gap-3">
          {isApproved && (
            <Link
              href="/member/add-product"
              className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:opacity-90 transition shadow-sm"
            >
              + Add New Product
            </Link>
          )}
          <Link
            href="/products"
            className="px-4 py-2 border border-border text-foreground text-xs font-bold rounded-lg hover:bg-muted transition"
          >
            View Live Storefront
          </Link>
        </div>
      </div>

      {msg && (
        <div className="p-3 rounded-lg text-xs font-bold bg-primary/10 border border-primary/20 text-primary">
          {msg}
        </div>
      )}

      {/* Financial & Sales Performance Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Delivered Account Earnings */}
        <div className="bg-card border border-emerald-500/30 p-6 rounded-2xl shadow-sm space-y-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl -mr-6 -mt-6"></div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Delivered Account Earnings</span>
          <p className="text-3xl font-black text-emerald-600">{formatCurrency(deliveredEarnings)}</p>
          <span className="text-[11px] text-muted-foreground font-medium block">
            Completed & Delivered Orders Total
          </span>
        </div>

        {/* Total Orders Revenue */}
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Sales Volume</span>
          <p className="text-3xl font-black text-foreground">{formatCurrency(totalRevenue)}</p>
          <span className="text-[11px] text-muted-foreground font-medium block">
            Across {totalUnitsSold} item units ordered
          </span>
        </div>

        {/* Pending Delivery Orders */}
        <div className="bg-card border border-amber-500/30 p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">Orders Pending Delivery</span>
          <p className="text-3xl font-black text-amber-500">{pendingDeliveryCount}</p>
          <span className="text-[11px] text-muted-foreground font-medium block">
            Requires your processing & dispatch
          </span>
        </div>

        {/* Live Catalog Items */}
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-bold text-primary uppercase tracking-wider">Store Catalog Items</span>
          <p className="text-3xl font-black text-foreground">{approvedProducts.length} <span className="text-xs font-semibold text-muted-foreground">/ {totalProducts}</span></p>
          <span className="text-[11px] text-muted-foreground font-medium block">
            Approved & active storefront products
          </span>
        </div>
      </div>

      {/* Navigation Tabs (Orders, Catalog, Monthly Analytics) */}
      <div className="flex border-b border-border space-x-6 text-sm font-bold">
        <button
          onClick={() => setActiveMainTab("ORDERS")}
          className={`pb-3 border-b-2 transition ${
            activeMainTab === "ORDERS"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          📦 Incoming Customer Orders ({orderItems.length})
        </button>
        <button
          onClick={() => setActiveMainTab("CATALOG")}
          className={`pb-3 border-b-2 transition ${
            activeMainTab === "CATALOG"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          🏷️ Manage Store Catalog ({totalProducts})
        </button>
        <button
          onClick={() => setActiveMainTab("ANALYTICS")}
          className={`pb-3 border-b-2 transition ${
            activeMainTab === "ANALYTICS"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          📊 Monthly Sales Breakdown
        </button>
      </div>

      {/* 1. INCOMING ORDERS & DELIVERY WORKFLOW TAB */}
      {activeMainTab === "ORDERS" && (
        <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border pb-4 gap-2">
            <div>
              <h2 className="text-lg font-bold text-foreground">Customer Order Processing Workflow</h2>
              <p className="text-xs text-muted-foreground">
                Approve orders after customer confirmation, prepare for shipment, and mark as 'Delivered' to credit earnings to your account.
              </p>
            </div>
            <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-lg">
              {orderItems.length} Total Orders Received
            </span>
          </div>

          {orderItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-xs space-y-2">
              <p className="font-semibold">No orders received for your products yet.</p>
              <p className="text-[11px]">When customers purchase your listed items, orders will appear here for processing.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {orderItems.map((item) => {
                const isDelivered = item.order.status === "DELIVERED";
                const isReady = item.order.status === "READY_FOR_DELIVERY" || item.order.status === "SHIPPED";
                const isProcessing = item.order.status === "PROCESSING" || item.order.status === "PENDING";
                const itemTotalPrice = item.price * item.quantity;

                return (
                  <div
                    key={item.id}
                    className={`border rounded-xl p-5 space-y-4 transition ${
                      isDelivered
                        ? "bg-emerald-500/5 border-emerald-500/30"
                        : isReady
                        ? "bg-amber-500/5 border-amber-500/30"
                        : "bg-background border-border"
                    }`}
                  >
                    {/* Header bar */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-border pb-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-foreground">
                            Order #{item.order.trackingNumber || item.order.id.substring(0, 8)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Placed: {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Customer: <strong className="text-foreground">{item.order.user?.name || "Customer"}</strong> ({item.order.user?.phone || item.order.user?.email || "No phone"})
                        </p>
                        {item.order.shippingAddress && (
                          <p className="text-[11px] text-muted-foreground">
                            📍 Address: <span className="text-foreground font-medium">{item.order.shippingAddress}</span>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isDelivered ? (
                          <span className="text-xs font-bold text-emerald-600 bg-emerald-500/20 px-3 py-1 rounded-lg border border-emerald-500/30">
                            ✓ Delivered (Earnings Credited)
                          </span>
                        ) : isReady ? (
                          <span className="text-xs font-bold text-amber-600 bg-amber-500/20 px-3 py-1 rounded-lg border border-amber-500/30">
                            🚚 Ready for Delivery / Out for Delivery
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-blue-600 bg-blue-500/20 px-3 py-1 rounded-lg border border-blue-500/30">
                            ⏳ Order Received (Pending Seller Action)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Product & Action Row */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div className="flex items-center gap-3">
                        {item.product.imageUrl ? (
                          <img
                            src={item.product.imageUrl}
                            alt={item.product.name}
                            className="w-14 h-14 rounded-lg object-contain bg-card border border-border p-1 shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-lg bg-muted border border-border shrink-0 flex items-center justify-center font-bold text-muted-foreground text-xs">
                            No Img
                          </div>
                        )}

                        <div className="space-y-1 text-xs">
                          <h4 className="font-bold text-sm text-foreground">{item.product.name}</h4>
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>Quantity: <strong className="text-foreground">{item.quantity} units</strong></span>
                            <span>•</span>
                            <span>Unit Price: <strong className="text-foreground">{formatCurrency(item.price)}</strong></span>
                          </div>
                          <p className="font-extrabold text-foreground text-sm">
                            Total Item Value: <span className="text-primary">{formatCurrency(itemTotalPrice)}</span>
                          </p>
                        </div>
                      </div>

                      {/* Workflow Actions */}
                      <div className="flex flex-wrap gap-2 w-full sm:w-auto shrink-0 border-t sm:border-t-0 border-border pt-3 sm:pt-0">
                        {isProcessing && (
                          <button
                            disabled={updatingOrderId === item.order.id}
                            onClick={() => handleUpdateStatus(item.order.id, "READY_FOR_DELIVERY")}
                            className="px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition shadow-sm"
                          >
                            {updatingOrderId === item.order.id ? "Updating..." : "✓ Approve & Prepare Delivery"}
                          </button>
                        )}

                        {!isDelivered && (
                          <button
                            disabled={updatingOrderId === item.order.id}
                            onClick={() => handleUpdateStatus(item.order.id, "DELIVERED")}
                            className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition shadow-sm"
                          >
                            {updatingOrderId === item.order.id ? "Updating..." : "📦 Mark as Delivered"}
                          </button>
                        )}

                        {isDelivered && (
                          <div className="text-xs text-emerald-600 font-bold bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                            💰 +{formatCurrency(itemTotalPrice)} Added to Account
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. MANAGE STORE CATALOG TAB */}
      {activeMainTab === "CATALOG" && (
        <div className="space-y-6">
          {/* Interactive Stat Filter Buttons / Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <button
              type="button"
              onClick={() => setActiveTab("ALL")}
              className={`text-left p-6 rounded-2xl border transition-all duration-200 shadow-sm ${
                activeTab === "ALL"
                  ? "bg-primary/10 border-primary ring-2 ring-primary/30"
                  : "bg-card border-border hover:border-primary/50"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-muted-foreground uppercase">Total Catalog Items</span>
                <span className="text-xs px-2 py-0.5 rounded bg-muted font-semibold text-foreground">Filter</span>
              </div>
              <p className="text-3xl font-extrabold text-foreground">{totalProducts}</p>
              <span className="text-[11px] text-muted-foreground font-medium">Click to view all listed items</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("APPROVED")}
              className={`text-left p-6 rounded-2xl border transition-all duration-200 shadow-sm ${
                activeTab === "APPROVED"
                  ? "bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/30"
                  : "bg-card border-border hover:border-emerald-500/50"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-emerald-600 uppercase">Approved & Live</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">Filter</span>
              </div>
              <p className="text-3xl font-extrabold text-emerald-600">{approvedProducts.length}</p>
              <span className="text-[11px] text-emerald-600 font-medium">Click to view live storefront products</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("PENDING")}
              className={`text-left p-6 rounded-2xl border transition-all duration-200 shadow-sm ${
                activeTab === "PENDING"
                  ? "bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30"
                  : "bg-card border-border hover:border-amber-500/50"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-amber-500 uppercase">Pending Admin Review</span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">Filter</span>
              </div>
              <p className="text-3xl font-extrabold text-amber-500">{pendingProducts.length}</p>
              <span className="text-[11px] text-muted-foreground font-medium">Click to view items awaiting admin approval</span>
            </button>
          </div>

          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border pb-4 gap-2">
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  {activeTab === "ALL" && `📦 All Storefront Products (${displayedProducts.length})`}
                  {activeTab === "APPROVED" && `✓ Approved & Live Products (${displayedProducts.length})`}
                  {activeTab === "PENDING" && `⏳ Pending Admin Approval Products (${displayedProducts.length})`}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {activeTab === "ALL" && "Showing all products in your vendor catalog."}
                  {activeTab === "APPROVED" && "Showing products approved by Admin currently visible to customers."}
                  {activeTab === "PENDING" && "Showing products submitted recently that are undergoing Admin moderation review."}
                </p>
              </div>

              <div className="flex items-center gap-1 bg-muted p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setActiveTab("ALL")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    activeTab === "ALL" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All ({totalProducts})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("APPROVED")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    activeTab === "APPROVED" ? "bg-background text-emerald-600 shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Live ({approvedProducts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("PENDING")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    activeTab === "PENDING" ? "bg-background text-amber-500 shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Pending ({pendingProducts.length})
                </button>
              </div>
            </div>

            {displayedProducts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-xs space-y-3">
                <p>
                  {activeTab === "ALL" && "You haven't listed any products yet."}
                  {activeTab === "APPROVED" && "No approved live products available yet."}
                  {activeTab === "PENDING" && "No products currently awaiting approval."}
                </p>
                {isApproved && (
                  <Link
                    href="/member/add-product"
                    className="inline-block px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-lg hover:opacity-90 transition"
                  >
                    + Add New Product
                  </Link>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {displayedProducts.map((product) => (
                  <div key={product.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/40 p-2 rounded-xl transition">
                    <div className="flex items-center gap-3">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-12 h-12 rounded-lg object-contain bg-muted border border-border p-1 shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted border border-border shrink-0 flex items-center justify-center font-bold text-muted-foreground text-xs">
                          No Img
                        </div>
                      )}

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                            {product.category?.name || "General"}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(product.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <h3 className="font-bold text-sm text-foreground">{product.name}</h3>
                        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                          <span>Price: <strong className="text-foreground">{formatCurrency(Number(product.price))}</strong></span>
                          <span>•</span>
                          <span>Stock: <strong className="text-foreground">{product.stock} units</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {product.status === "APPROVED" ? (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                          ✓ Live Storefront
                        </span>
                      ) : product.status === "REJECTED" ? (
                        <span className="text-xs font-bold text-red-600 bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20">
                          ❌ Rejected
                        </span>
                      ) : (
                        <span className="text-xs font-extrabold text-amber-600 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20">
                          ⏳ Pending Admin Approval
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. MONTHLY SALES & EARNINGS BREAKDOWN TAB */}
      {activeMainTab === "ANALYTICS" && (
        <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-6">
          <div className="border-b border-border pb-4">
            <h2 className="text-lg font-bold text-foreground">📊 Month-wise Sales & Earnings Report</h2>
            <p className="text-xs text-muted-foreground">
              Detailed breakdown of orders count, gross sales volume, and net delivered earnings grouped by month.
            </p>
          </div>

          {monthlyAnalytics.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs font-medium">
              No sales recorded yet to generate monthly analytics report.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground font-bold uppercase text-[11px] bg-muted/30">
                    <th className="p-3 rounded-l-lg">Month Period</th>
                    <th className="p-3">Orders Count</th>
                    <th className="p-3">Gross Sales Volume</th>
                    <th className="p-3 rounded-r-lg">Delivered Account Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {monthlyAnalytics.map((m, idx) => (
                    <tr key={idx} className="hover:bg-muted/30 transition">
                      <td className="p-3 font-extrabold text-foreground">{m.monthLabel}</td>
                      <td className="p-3 font-bold text-foreground">{m.ordersCount} orders</td>
                      <td className="p-3 font-bold text-foreground">{formatCurrency(m.totalRevenue)}</td>
                      <td className="p-3 font-black text-emerald-600">{formatCurrency(m.deliveredEarnings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
