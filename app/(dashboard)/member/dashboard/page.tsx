import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/formatter";

export default async function SellerDashboardPage() {
  // Fetch seller details
  const seller = await prisma.user.findFirst({
    where: { role: "MEMBER" },
  });

  const isApproved = seller ? seller.sellerStatus === "APPROVED" : true;
  const isBlocked = seller ? seller.sellerStatus === "BLOCKED" : false;
  const isPending = seller ? seller.sellerStatus === "PENDING" : false;

  // Fetch seller's products (Filtered strictly by seller's own sellerId)
  const products = seller
    ? await prisma.product.findMany({
        where: { sellerId: seller.id },
        orderBy: { createdAt: "desc" },
        include: {
          category: { select: { name: true } },
        },
      })
    : [];

  const totalProducts = products.length;
  const approvedProducts = products.filter((p) => p.status === "APPROVED");
  const pendingProducts = products.filter((p) => p.status === "PENDING_APPROVAL");
  const rejectedProducts = products.filter((p) => p.status === "REJECTED");

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Seller Account Status Alert Banners */}
      {isPending && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⏳</span>
            <span>Seller Account Pending Admin Approval</span>
          </div>
          <p className="text-xs">Your seller account is currently under moderation review by the Super Admin. You cannot publish new products until your account is approved.</p>
        </div>
      )}

      {isBlocked && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⛔</span>
            <span>Seller Account Suspended / Blocked</span>
          </div>
          <p className="text-xs">Your vendor permissions have been temporarily restricted by the Admin. Product addition is hidden and disabled.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            Vendor Portal
          </span>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">Seller Dashboard</h1>
          <p className="text-xs text-muted-foreground">Manage your store products, monitor sales earnings, and add new product listings.</p>
        </div>

        <div className="flex gap-3">
          {/* COMPLETELY HIDE Add Product button if seller is not approved */}
          {isApproved && (
            <Link href="/member/add-product" className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:opacity-90 transition">
              + Add New Product
            </Link>
          )}
          <Link href="/products" className="px-4 py-2 border border-border text-foreground text-xs font-bold rounded-lg hover:bg-muted transition">
            View Live Storefront
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Total Catalog Items</span>
          <p className="text-2xl font-extrabold text-foreground">{totalProducts}</p>
          <span className="text-[11px] text-muted-foreground font-medium">In your vendor account</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Approved & Live</span>
          <p className="text-2xl font-extrabold text-emerald-600">{approvedProducts.length}</p>
          <span className="text-[11px] text-emerald-600 font-medium">Live on storefront</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Pending Admin Review</span>
          <p className="text-2xl font-extrabold text-amber-500">{pendingProducts.length}</p>
          <span className="text-[11px] text-muted-foreground font-medium">Awaiting Admin Approval</span>
        </div>
      </div>

      {/* 1. SELLER'S PENDING PRODUCTS SECTION */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">⏳ Pending Approval Products ({pendingProducts.length})</h2>
            <p className="text-xs text-muted-foreground">Products you recently added that are currently awaiting review by the Super Admin.</p>
          </div>
          <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded">
            {pendingProducts.length} Pending Review
          </span>
        </div>

        {pendingProducts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs font-medium">
            ✓ No products currently pending approval. All your submitted products have been reviewed!
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pendingProducts.map((product) => (
              <div key={product.id} className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded">
                    {product.category?.name || "General"}
                  </span>
                  <h3 className="font-bold text-sm text-foreground">{product.name}</h3>
                  <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                    <span>Price: <strong className="text-foreground">{formatCurrency(Number(product.price))}</strong></span>
                    <span>•</span>
                    <span>Stock: <strong className="text-foreground">{product.stock} units</strong></span>
                    <span>•</span>
                    <span>Submitted: <strong className="text-foreground">{new Date(product.createdAt).toLocaleDateString()}</strong></span>
                  </div>
                </div>

                <span className="text-xs font-extrabold text-amber-600 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20">
                  ⏳ Pending Admin Approval
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. SELLER'S LIVE & APPROVED PRODUCTS SECTION */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">✓ Approved & Live Products ({approvedProducts.length})</h2>
            <p className="text-xs text-muted-foreground">Products that have been approved by Admin and are currently active on the storefront.</p>
          </div>

          {isApproved && (
            <Link href="/member/add-product" className="text-xs font-bold text-primary hover:underline">
              + Add Product
            </Link>
          )}
        </div>

        {approvedProducts.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-xs space-y-3">
            <p>You don't have any approved live products on the storefront yet.</p>
            {isApproved && (
              <Link href="/member/add-product" className="inline-block px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-lg">
                Add Your First Product
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {approvedProducts.map((product) => (
              <div key={product.id} className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-foreground">{product.name}</h3>
                  <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                    <span>Category: <strong className="text-foreground">{product.category?.name || "General"}</strong></span>
                    <span>•</span>
                    <span>Price: <strong className="text-foreground">{formatCurrency(Number(product.price))}</strong></span>
                    <span>•</span>
                    <span>Stock: <strong className="text-foreground">{product.stock} units</strong></span>
                  </div>
                </div>

                <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20">
                  ✓ Live Storefront
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}