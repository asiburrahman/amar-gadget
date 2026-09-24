import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/formatter";
import { AdminProductManageActions } from "../_components/admin-product-manage-actions";

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    include: {
      category: { select: { name: true } },
      seller: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
            <Link href="/admin" className="hover:text-primary">Admin Control Center</Link>
            <span>/</span>
            <span className="text-foreground font-bold">Catalog & Product Control</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground">Manage Platform Products</h1>
          <p className="text-xs text-muted-foreground">Edit seller prices, delete outdated listings, and control product status across the entire store.</p>
        </div>

        <Link href="/admin" className="px-4 py-2 border border-border text-foreground text-xs font-bold rounded-lg hover:bg-muted transition">
          &larr; Back to Admin Dashboard
        </Link>
      </div>

      {/* Products List */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">All Storefront Products ({products.length})</h2>

        {products.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs">
            No products found in store database.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {products.map((product) => {
              const numericPrice = Number(product.price);
              const numericDiscountPrice = product.discountPrice ? Number(product.discountPrice) : null;

              return (
                <div key={product.id} className="py-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                        {product.category?.name || "General"}
                      </span>
                      {product.status === "APPROVED" ? (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">APPROVED</span>
                      ) : product.status === "REJECTED" ? (
                        <span className="text-[10px] font-bold text-red-600 bg-red-500/10 px-2 py-0.5 rounded">REJECTED</span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">PENDING</span>
                      )}
                    </div>
                    <h3 className="font-bold text-sm text-foreground truncate">{product.name}</h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>Seller: <strong className="text-foreground">{product.seller?.name || product.seller?.email}</strong></span>
                      <span>•</span>
                      <span>Price: <strong className="text-foreground">{formatCurrency(numericPrice)}</strong></span>
                      {numericDiscountPrice && (
                        <>
                          <span>•</span>
                          <span>Discount: <strong className="text-emerald-600">{formatCurrency(numericDiscountPrice)}</strong></span>
                        </>
                      )}
                      <span>•</span>
                      <span>Stock: <strong className="text-foreground">{product.stock}</strong></span>
                    </div>
                  </div>

                  <AdminProductManageActions
                    productId={product.id}
                    currentPrice={numericPrice}
                    currentDiscountPrice={numericDiscountPrice}
                    currentStatus={product.status}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}