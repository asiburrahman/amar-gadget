import React from "react";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { redirect } from "next/navigation";
import SellerDashboardClient from "./seller-dashboard-client";
import { DashboardAccessError, dashboardYear, readSellerDashboardMetrics } from "@/lib/dashboard-metrics";
import Link from "next/link";

export const revalidate = 0; // Ensure fresh data on every request

export default async function SellerDashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const currentUser = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
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
  let metrics;
  try { metrics = await readSellerDashboardMetrics(currentUser, year); }
  catch (error) { if (error instanceof DashboardAccessError) redirect("/login"); throw error; }

  const seller = await prisma.user.findUnique({ where: { id: currentUser.id } });

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

  const serializedProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: Number(p.price),
    discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
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
      metrics={metrics}
      initialMainTab={query.year === undefined ? "ORDERS" : "ANALYTICS"}
      key={`${currentUser.id}:${year}`}
    />
  );
}
