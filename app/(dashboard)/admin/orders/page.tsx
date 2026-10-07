import React from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwtToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { getAllOrdersForAdmin } from "@/server/actions/order/order-actions";
import AdminOrdersClient from "./admin-orders-client";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  let currentUserRole: string | null = null;
  if (token) {
    const payload = await verifyJwtToken(token);
    if (payload?.role) {
      currentUserRole = payload.role as string;
    }
  }

  // Ensure Admin role
  if (currentUserRole !== "ADMIN") {
    redirect("/login");
  }

  const { data: orders = [] } = await getAllOrdersForAdmin();

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Admin Dashboard
            </Link>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="text-xs font-bold text-primary">All Platform Orders</span>
          </div>
          <h1 className="text-3xl font-extrabold text-foreground mt-2">
            Platform Orders Management
          </h1>
          <p className="text-xs text-muted-foreground">
            Full visibility into all customer orders across all marketplace vendors with real-time fulfillment controls.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="outline" className="font-bold text-xs">
              ← Back to Overview
            </Button>
          </Link>
          <Link href="/admin/products">
            <Button variant="default" className="font-bold text-xs">
              Manage Products
            </Button>
          </Link>
        </div>
      </div>

      {/* Admin Orders Management Table */}
      <AdminOrdersClient initialOrders={orders as any} />
    </div>
  );
}