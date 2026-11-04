import React from "react";
import { readSellerDashboardCatalog } from "@/lib/seller-dashboard-catalog";
import { sellerDashboardCatalogQuerySchema } from "@/lib/validations/collection-query";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { serviceUnavailable } from "@/lib/observability";
import { getCurrentUserWithRole } from "@/lib/session";
import { redirect } from "next/navigation";
import SellerDashboardClient from "./seller-dashboard-client";
import { DashboardAccessError, dashboardYear, readSellerDashboardMetrics } from "@/lib/dashboard-metrics";
import Link from "next/link";

export const revalidate = 0; // Ensure fresh data on every request

export default async function SellerDashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  let currentUser;
  try { currentUser = await getCurrentUserWithRole(["MEMBER", "ADMIN"]); } catch (error) { throw serviceUnavailable("seller.session", error); }
  if (!currentUser) redirect("/login");
  if (currentUser.role.toUpperCase() === "ADMIN") redirect("/admin");
  // Suspended/pending sellers retain their profile and status, but cannot read
  // customer order details. Match the seller actions' server-side policy.
  if (currentUser.sellerStatus !== "APPROVED") {
    return (
      <section className="mx-auto max-w-2xl space-y-3 rounded-xl border p-6">
        <h1 className="text-2xl font-bold">Seller account status</h1>
        <p>Your account is {currentUser.sellerStatus.toLowerCase()}. Store management and customer orders are available after administrator approval.</p>
        <a href="/member/profile" className="text-primary underline">Manage your profile</a>
      </section>
    );
  }
  const query = searchParams ? await searchParams : {};
  const year = dashboardYear(query.year);
  if (year === null) return <main className="p-6"><p role="alert">Invalid analytics year. <Link href="/member/dashboard">Reset dashboard</Link></p></main>;
  const parsed = sellerDashboardCatalogQuerySchema.safeParse({ page: query.page, q: query.q, status: query.status });
  if (!parsed.success) return <main className="p-6"><p role="alert">Invalid catalog filters. <Link href="/member/dashboard?status=ALL">Reset catalog</Link></p></main>;
  let metrics;
  try { metrics = await readSellerDashboardMetrics(currentUser, year); }
  catch (error) { if (error instanceof DashboardAccessError) redirect("/login"); throw serviceUnavailable("seller.metrics", error); }
  let catalog;
  try { catalog = await readSellerDashboardCatalog(currentUser, parsed.data); }
  catch (error) {
    if (error instanceof ReadAccessError) redirect("/login");
    if (error instanceof ReadPageError) return <main className="p-6 space-y-3"><p role="alert">{error.message}</p><Link href={`/member/dashboard?${new URLSearchParams({ q: parsed.data.q, status: parsed.data.status, year: String(year) })}`}>Load the first catalog page</Link></main>;
    throw error;
  }
  const { products, seller } = catalog;

  const serializedProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    stock: p.stock,
    imageUrl: p.imageUrl,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    category: p.category ? { name: p.category.name } : null,
  }));

  const serializedSeller = seller
    ? {
        id: seller.id,
        name: seller.name,
        email: seller.email,
        sellerStatus: seller.sellerStatus || "PENDING",
      }
    : null;

  return (
    <SellerDashboardClient
      seller={serializedSeller}
      products={serializedProducts}
      catalogPage={{ q: catalog.q, status: catalog.status, page: catalog.page, totalPages: catalog.totalPages, total: catalog.total, counts: catalog.counts }}
      metrics={metrics}
      initialMainTab={query.page !== undefined || query.status !== undefined || query.q !== undefined ? "CATALOG" : query.year === undefined ? "ORDERS" : "ANALYTICS"}
      key={`${currentUser.id}:${year}:${catalog.page}:${catalog.q}:${catalog.status}`}
    />
  );
}
