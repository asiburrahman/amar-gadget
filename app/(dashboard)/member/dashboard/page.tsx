import React from "react";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { redirect } from "next/navigation";
import SellerDashboardClient from "./seller-dashboard-client";

export const revalidate = 0; // Ensure fresh data on every request

export default async function SellerDashboardPage() {
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

  // Fetch orders placed for seller's products
  const orderItemsRaw = seller
    ? await prisma.orderItem.findMany({
        where: {
          fulfillment: { is: { sellerId: seller.id } },
        },
        orderBy: { createdAt: "desc" },
        include: {
          order: { select: { id: true, paymentMethod: true, paymentStatus: true, createdAt: true } },
          fulfillment: { select: { status: true, codCollected: true } },
          product: { select: { id: true, name: true, imageUrl: true, price: true } },
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

  const serializedOrderItems = orderItemsRaw.map((item) => ({
    id: item.id,
    orderId: item.orderId,
    productId: item.productId,
    quantity: item.quantity,
    price: Number(item.price),
    createdAt: item.createdAt.toISOString(),
    product: {
      id: item.product.id,
      name: item.product.name,
      imageUrl: item.product.imageUrl,
      price: Number(item.product.price),
    },
    order: {
      id: item.order.id,
      status: item.fulfillment!.status,
      paymentMethod: item.order.paymentMethod,
      paymentStatus: item.order.paymentMethod === "COD" ? item.fulfillment!.codCollected ? "PAID" : "UNPAID" : item.order.paymentStatus,
      createdAt: item.order.createdAt.toISOString(),
    },
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
      orderItems={serializedOrderItems}
    />
  );
}
