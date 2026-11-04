import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { readAdminCatalog } from "@/lib/admin-catalog-read";
import { adminCatalogQuerySchema } from "@/lib/validations/collection-query";
import { PRODUCT_STATUSES } from "@/lib/catalog-constants";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { serviceUnavailable } from "@/lib/observability";
import { formatCurrency } from "@/lib/formatter";
import { AdminProductManageActions } from "../_components/admin-product-manage-actions";
import { AdminSpecificationEditor } from "@/components/catalog/admin-specification-editor";

export default async function AdminProductsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  let actor;
  try { actor = await getCurrentUserWithRole(["ADMIN"]); } catch (error) { throw serviceUnavailable("admin.session", error); }
  if (!actor) redirect("/login");
  const parsed = adminCatalogQuerySchema.safeParse(searchParams ? await searchParams : {});
  if (!parsed.success) return <main className="p-6 space-y-3"><h1>Manage Platform Products</h1><p role="alert">Check the product search, status filter and page number.</p><Link href="/admin/products" className="underline">Reset product filters</Link></main>;
  const query = parsed.data;
  const pageHref = (page: number) => `/admin/products?${new URLSearchParams({ q: query.q, status: query.status, page: String(page) })}`;
  let result;
  try { result = await readAdminCatalog(actor, query); }
  catch (error) {
    if (error instanceof ReadAccessError) redirect("/login");
    if (error instanceof ReadPageError) return <main className="p-6 space-y-3"><h1>Manage Platform Products</h1><p role="alert">{error.message}</p><Link href={pageHref(1)} className="underline">Load the first product page</Link></main>;
    throw error;
  }
  const { products, total, page, totalPages } = result;

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
        <h2 className="text-lg font-bold text-foreground border-b border-border pb-3">Matching platform products ({total})</h2>
        <form method="GET" action="/admin/products" className="flex flex-wrap items-end gap-3">
          <label>Product name, seller name/email or exact product ID<input name="q" type="search" maxLength={120} defaultValue={query.q} className="block rounded border px-3 py-2" /></label>
          <label>Status<select name="status" defaultValue={query.status} className="block rounded border px-3 py-2"><option value="ALL">All statuses</option>{PRODUCT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <button type="submit" className="rounded border px-3 py-2">Apply product filters</button>
        </form>
        <p>Page {page} of {totalPages}; {products.length} shown. Search and totals apply to the whole matching catalog.</p>

        {products.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs">
            No products match these filters.
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
                      ) : product.status === "ARCHIVED" ? <span className="text-xs font-bold">ARCHIVED</span> : product.status === "REJECTED" ? (
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

                  <div className="space-y-3"><AdminSpecificationEditor productId={product.id} specifications={product.specifications} />
                  <AdminProductManageActions
                    productId={product.id}
                    currentPrice={numericPrice}
                    currentDiscountPrice={numericDiscountPrice}
                    currentStatus={product.status}
                    currentVersion={product.catalogVersion}
                  />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <nav aria-label="Platform product pages" className="flex flex-wrap gap-4">{page > 1 && <Link href={pageHref(page - 1)} className="underline">Previous products</Link>}{page < totalPages && <Link href={pageHref(page + 1)} className="underline">Next products</Link>}</nav>
      </div>
    </div>
  );
}
