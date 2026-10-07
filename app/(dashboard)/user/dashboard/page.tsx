import React from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyJwtToken } from "@/lib/auth";
import { formatCurrency } from "@/lib/formatter";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function CustomerDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  let currentUserId: string | null = null;
  if (token) {
    const payload = await verifyJwtToken(token);
    if (payload?.sub) {
      currentUserId = payload.sub as string;
    }
  }

  if (!currentUserId) {
    redirect("/login");
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: currentUserId },
  });

  // Fetch orders STRICTLY belonging to the logged-in customer
  const orders = await prisma.order.findMany({
    where: { userId: currentUserId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { name: true, imageUrl: true, slug: true } },
        },
      },
    },
    take: 10,
  });

  const totalSpent = orders.reduce((sum, o) => sum + Number(o.total), 0);
  const pendingOrders = orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED").length;

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
            Customer Dashboard
          </span>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">
            Welcome back, {currentUser?.name || "Customer"}!
          </h1>
          <p className="text-xs text-muted-foreground">
            Track your individual orders, view real-time delivery status, and manage your account.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/user/orders">
            <Button variant="default" className="font-bold text-xs flex items-center gap-1.5 shadow-sm">
              <span>📦 All My Orders ({orders.length})</span>
            </Button>
          </Link>
          <Link href="/user/profile">
            <Button variant="outline" className="font-bold text-xs flex items-center gap-1.5">
              <span>👤 Profile & Settings</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Orders Placed</span>
          <p className="text-2xl font-extrabold text-foreground">{orders.length}</p>
          <p className="text-[11px] text-muted-foreground">All time electronic purchases</p>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Active Deliveries</span>
          <p className="text-2xl font-extrabold text-amber-500">{pendingOrders}</p>
          <p className="text-[11px] text-muted-foreground">Currently processing or in transit</p>
        </div>
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Spent</span>
          <p className="text-2xl font-extrabold text-emerald-600">{formatCurrency(totalSpent)}</p>
          <p className="text-[11px] text-muted-foreground">Completed order value</p>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">My Orders History</h2>
            <p className="text-xs text-muted-foreground">Strictly showing orders placed by your account ({currentUser?.email})</p>
          </div>
          {orders.length > 0 && (
            <Link href="/user/orders" className="text-xs font-bold text-primary hover:underline">
              View All Orders →
            </Link>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-14 text-muted-foreground text-xs space-y-3">
            <div className="text-3xl">📦</div>
            <p className="font-semibold text-foreground text-sm">You haven't placed any orders yet.</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Browse our curated collection of smartphones, laptops, audio gear, and accessories.
            </p>
            <div className="pt-2">
              <Link href="/products">
                <Button variant="default" className="font-bold text-xs">Start Shopping Now</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {orders.map((order) => {
              const statusColors: Record<string, string> = {
                DELIVERED: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
                SHIPPED: "text-purple-600 bg-purple-500/10 border-purple-500/20",
                PROCESSING: "text-blue-600 bg-blue-500/10 border-blue-500/20",
                PENDING: "text-amber-600 bg-amber-500/10 border-amber-500/20",
                CANCELLED: "text-destructive bg-destructive/10 border-destructive/20",
              };
              const badgeClass = statusColors[order.status] || "text-muted-foreground bg-muted border-border";

              return (
                <div key={order.id} className="py-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded text-[11px]">
                        Order #{order.id.slice(0, 8)}
                      </span>
                      {order.trackingNumber && (
                        <span className="text-muted-foreground text-[11px]">
                          Tracking: <strong className="font-mono text-foreground">{order.trackingNumber}</strong>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${badgeClass}`}>
                        {order.status}
                      </span>
                      <span className="font-extrabold text-foreground text-sm">
                        {formatCurrency(Number(order.total))}
                      </span>
                      {order.trackingNumber && (
                        <Link href={`/track-order?id=${order.trackingNumber}`}>
                          <Button variant="outline" size="sm" className="h-7 text-[11px] font-bold">
                            Track
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Order Items preview */}
                  <div className="bg-muted/30 border border-border/50 rounded-xl p-3 flex flex-wrap items-center gap-3">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        {item.product.imageUrl ? (
                          <img
                            src={item.product.imageUrl}
                            alt={item.product.name}
                            className="w-8 h-8 rounded-md object-cover border border-border"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-muted border border-border flex items-center justify-center text-[10px]">
                            📱
                          </div>
                        )}
                        <span className="font-medium text-foreground text-xs truncate max-w-[200px]">
                          {item.product.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}