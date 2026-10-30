import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import UserOrdersClient from "./user-orders-client";
import { customerShipment, customerShipmentSelect } from "@/lib/fulfillments";

export const dynamic = "force-dynamic";

export default async function CustomerOrdersPage() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const currentUserId = actor.id;
  const currentUser = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, name: true, email: true } });
  if (!currentUser) redirect("/login");

  // Fetch orders STRICTLY belonging to this user
  const orders = await prisma.order.findMany({
    where: { userId: currentUserId },
    orderBy: { createdAt: "desc" },
    include: {
      fulfillments: { where: { items: { some: {} } }, orderBy: { id: "asc" }, select: customerShipmentSelect },
      items: {
        include: {
          product: {
            select: { id: true, name: true, imageUrl: true, slug: true },
          },
        },
      },
    },
  });

  const serializedOrders = orders.map((o) => ({
    id: o.id,
    total: Number(o.total),
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    shippingAddress: o.shippingAddress,
    trackingNumber: o.trackingNumber,
    fulfillments: o.fulfillments.map(customerShipment),
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      price: Number(i.price),
      product: {
        id: i.product.id,
        name: i.product.name,
        imageUrl: i.product.imageUrl,
        slug: i.product.slug,
      },
    })),
  }));

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/user/dashboard"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="text-xs font-bold text-primary">My Orders</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">
            My Order History
          </h1>
          <p className="text-xs text-muted-foreground">
            View details, tracking numbers, and delivery status for all orders placed with <strong>{currentUser.email}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/user/dashboard">
            <Button variant="outline" className="font-bold text-xs">
              ← Back to Dashboard
            </Button>
          </Link>
          <Link href="/products">
            <Button variant="default" className="font-bold text-xs">
              Explore Products
            </Button>
          </Link>
        </div>
      </div>

      {/* Interactive Orders List Component */}
      <UserOrdersClient user={currentUser} initialOrders={serializedOrders} />
    </div>
  );
}
