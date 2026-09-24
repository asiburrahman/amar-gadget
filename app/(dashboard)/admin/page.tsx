import React from "react";
import Link from "next/link";
import { getAdminStats } from "@/server/actions/admin/admin-actions";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/formatter";
import { AdminProductActions } from "./_components/admin-product-actions";

export default async function AdminDashboardPage() {
  const statsResult = await getAdminStats();
  const stats = statsResult.stats;

  // Fetch pending products for approval
  const pendingProducts = await prisma.product.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: {
      category: { select: { name: true } },
      seller: { select: { name: true, email: true } },
    },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            Super Admin Control Center
          </span>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">Platform Administration</h1>
          <p className="text-xs text-muted-foreground">Monitor platform performance, verify vendor products, and manage system operations.</p>
        </div>

        <div className="flex gap-3">
          <Link href="/admin/products" className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:opacity-90 transition">
            Manage All Products ({stats.totalProducts})
          </Link>
          <Link href="/" className="px-4 py-2 border border-border text-foreground text-xs font-bold rounded-lg hover:bg-muted transition">
            View Live Store
          </Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Total Gross Sales</span>
          <p className="text-2xl font-extrabold text-foreground">{formatCurrency(stats.totalRevenue)}</p>
          <span className="text-[11px] text-emerald-600 font-medium">✓ Verified System Transactions</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Pending Product Approvals</span>
          <p className="text-2xl font-extrabold text-amber-500">{stats.pendingProducts}</p>
          <span className="text-[11px] text-muted-foreground font-medium">Requires Admin Verification</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Total Platform Products</span>
          <p className="text-2xl font-extrabold text-foreground">{stats.totalProducts}</p>
          <span className="text-[11px] text-muted-foreground font-medium">Active Catalog Listings</span>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Registered Platform Users</span>
          <p className="text-2xl font-extrabold text-foreground">{stats.totalUsers}</p>
          <span className="text-[11px] text-emerald-600 font-medium">Customers & Vendors</span>
        </div>
      </div>

      {/* Product Approval Queue */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Vendor Product Moderation Queue</h2>
            <p className="text-xs text-muted-foreground">Approve or reject newly submitted vendor products before they appear live in store.</p>
          </div>
          <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded">
            {pendingProducts.length} Pending Approval
          </span>
        </div>

        {pendingProducts.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-xs font-medium">
            ✓ No pending product approvals. All submitted products are reviewed!
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pendingProducts.map((product) => (
              <div key={product.id} className="py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                    {product.category?.name || "General"}
                  </span>
                  <h3 className="font-bold text-sm text-foreground">{product.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    Seller: <span className="font-semibold text-foreground">{product.seller?.name || product.seller?.email}</span> | Price: <span className="font-bold text-foreground">{formatCurrency(Number(product.price))}</span> | Stock: {product.stock} units
                  </p>
                </div>

                <AdminProductActions productId={product.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
