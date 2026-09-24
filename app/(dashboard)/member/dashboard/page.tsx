import React from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyJwtToken } from "@/lib/auth";
import SellerDashboardClient from "./seller-dashboard-client";

export const revalidate = 0; // Ensure fresh data on every request

export default async function SellerDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  let currentUserId: string | null = null;
  if (token) {
    const payload = await verifyJwtToken(token);
    if (payload?.sub) {
      currentUserId = payload.sub as string;
    }
  }

  // Fetch logged in user or fallback to member user
  const seller = currentUserId
    ? await prisma.user.findUnique({ where: { id: currentUserId } })
    : await prisma.user.findFirst({ where: { role: "MEMBER" } });

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
          product: { sellerId: seller.id },
        },
        orderBy: { createdAt: "desc" },
        include: {
          order: {
            include: {
              user: { select: { name: true, email: true, phone: true } },
            },
          },
          product: { select: { id: true, name: true, imageUrl: true, price: true } },
        },
      })
    : [];

  const serializedProducts = products.map((p) => ({
    ...p,
    price: Number(p.price),
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
      status: item.order.status,
      paymentMethod: item.order.paymentMethod,
      paymentStatus: item.order.paymentStatus,
      shippingAddress: item.order.shippingAddress,
      trackingNumber: item.order.trackingNumber,
      createdAt: item.order.createdAt.toISOString(),
      user: item.order.user,
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