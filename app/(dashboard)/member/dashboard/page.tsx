import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/formatter";

export default async function SellerDashboardPage() {
  // Fetch seller's products
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { name: true } },
    },
    take: 10,
  });

  const totalProducts = products.length;
  const approvedCount = products.filter((p) => p.status === "APPROVED").length;
  const pendingCount = products.filter((p) => p.status === "PENDING_APPROVAL").length;

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
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
          <Link href="/member/add-product" className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:opacity-90 transition">
            + Add New Product
          </Link>
          <Link href="/products" className="px-4 py-2 border border-border text-foreground text-xs font-bold rounded-lg hover:bg-muted transition">
            View Live Storefront
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Total Products</span>
          <p className="text-2xl font-extrabold text-foreground">{totalProducts}</p>
          <span className="text-[11px] text-muted-foreground font-medium">In your store catalog</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Approved & Live</span>
          <p className="text-2xl font-extrabold text-emerald-600">{approvedCount}</p>
          <span className="text-[11px] text-emerald-600 font-medium">Visible to all customers</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Pending Admin Review</span>
          <p className="text-2xl font-extrabold text-amber-500">{pendingCount}</p>
          <span className="text-[11px] text-muted-foreground font-medium">Under moderation review</span>
        </div>
      </div>

      {/* Seller Products List */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-border pb-4">
          <h2 className="text-lg font-bold text-foreground">Your Product Listings</h2>
          <Link href="/member/add-product" className="text-xs font-bold text-primary hover:underline">
            + Add Product
          </Link>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs space-y-3">
            <p>You haven't listed any products yet.</p>
            <Link href="/member/add-product" className="inline-block px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-lg">
              Add Your First Product
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {products.map((product) => (
              <div key={product.id} className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-foreground">{product.name}</h3>
                  <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                    <span>Category: <strong className="text-foreground">{product.category?.name || "General"}</strong></span>
                    <span>•</span>
                    <span>Price: <strong className="text-foreground">{formatCurrency(Number(product.price))}</strong></span>
                    <span>•</span>
                    <span>Stock: <strong className="text-foreground">{product.stock}</strong></span>
                  </div>
                </div>

                <div>
                  {product.status === "APPROVED" ? (
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded">Live</span>
                  ) : product.status === "REJECTED" ? (
                    <span className="text-xs font-bold text-destructive bg-destructive/10 px-2.5 py-1 rounded">Rejected</span>
                  ) : (
                    <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded">Pending Review</span>
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