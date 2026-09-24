"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/formatter";

interface ProductItem {
  id: string;
  name: string;
  price: any;
  stock: number;
  status: string;
  createdAt: Date;
  imageUrl?: string | null;
  category?: { name: string } | null;
}

interface SellerDashboardClientProps {
  seller: {
    id: string;
    name: string | null;
    email: string;
    sellerStatus: string;
  } | null;
  products: ProductItem[];
}

export default function SellerDashboardClient({ seller, products }: SellerDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<"ALL" | "APPROVED" | "PENDING">("ALL");

  const sellerStatus = seller?.sellerStatus || "PENDING";
  const isApproved = sellerStatus === "APPROVED";
  const isBlocked = sellerStatus === "BLOCKED";
  const isPending = sellerStatus === "PENDING";

  const totalProducts = products.length;
  const approvedProducts = products.filter((p) => p.status === "APPROVED");
  const pendingProducts = products.filter((p) => p.status === "PENDING_APPROVAL");

  // Determine filtered list based on active tab
  const displayedProducts =
    activeTab === "APPROVED"
      ? approvedProducts
      : activeTab === "PENDING"
      ? pendingProducts
      : products;

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
            Your vendor permissions have been temporarily restricted by the Admin. Product creation and listing are hidden and disabled.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            Vendor Portal
          </span>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">Seller Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Manage your store catalog, check product review status, and monitor inventory.
          </p>
        </div>

        <div className="flex gap-3">
          {/* COMPLETELY HIDE Add Product button if seller is not approved */}
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

      {/* Interactive Stat Filter Buttons / Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Card 1: All Products */}
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

        {/* Card 2: Approved & Live */}
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

        {/* Card 3: Pending Admin Review */}
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

      {/* Unified Interactive Filtered Product Catalog List */}
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

          {/* Quick tab switch pills */}
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
  );
}
