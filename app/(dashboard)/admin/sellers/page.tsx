import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AdminSellerActions } from "../_components/admin-seller-actions";

export default async function AdminSellersPage() {
  const sellers = await prisma.user.findMany({
    where: { role: "MEMBER" },
    include: {
      _count: { select: { products: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalSellers = sellers.length;
  const approvedSellers = sellers.filter((s) => s.sellerStatus === "APPROVED").length;
  const pendingSellers = sellers.filter((s) => s.sellerStatus === "PENDING").length;
  const blockedSellers = sellers.filter((s) => s.sellerStatus === "BLOCKED").length;

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
            <Link href="/admin" className="hover:text-primary">Admin Control Center</Link>
            <span>/</span>
            <span className="text-foreground font-bold">Vendor & Seller Management</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground">Registered Sellers & Vendors</h1>
          <p className="text-xs text-muted-foreground">Approve new vendor applications, block abusive sellers, and manage platform seller permissions.</p>
        </div>

        <Link href="/admin" className="px-4 py-2 border border-border text-foreground text-xs font-bold rounded-lg hover:bg-muted transition">
          &larr; Back to Admin Dashboard
        </Link>
      </div>

      {/* Stats Header */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Total Vendors</span>
          <p className="text-2xl font-extrabold text-foreground">{totalSellers}</p>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Approved & Active</span>
          <p className="text-2xl font-extrabold text-emerald-600">{approvedSellers}</p>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Pending Review</span>
          <p className="text-2xl font-extrabold text-amber-500">{pendingSellers}</p>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Blocked / Suspended</span>
          <p className="text-2xl font-extrabold text-red-600">{blockedSellers}</p>
        </div>
      </div>

      {/* Sellers List Table */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">All Vendor Accounts ({sellers.length})</h2>

        {sellers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs">
            No vendor accounts registered yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sellers.map((seller) => (
              <div key={seller.id} className="py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-foreground">{seller.name || "Vendor User"}</span>
                    <span className="text-xs text-muted-foreground">({seller.email})</span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                    <span>Products Listed: <strong className="text-foreground">{seller._count.products}</strong></span>
                    <span>•</span>
                    <span>Joined: <strong className="text-foreground">{new Date(seller.createdAt).toLocaleDateString()}</strong></span>
                    <span>•</span>
                    <span>
                      Status:{" "}
                      {seller.sellerStatus === "APPROVED" ? (
                        <span className="text-emerald-600 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[11px]">Approved</span>
                      ) : seller.sellerStatus === "BLOCKED" ? (
                        <span className="text-red-600 font-bold bg-red-500/10 px-2 py-0.5 rounded text-[11px]">Blocked</span>
                      ) : (
                        <span className="text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded text-[11px]">Pending Approval</span>
                      )}
                    </span>
                  </div>
                </div>

                <AdminSellerActions sellerId={seller.id} currentStatus={seller.sellerStatus} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
