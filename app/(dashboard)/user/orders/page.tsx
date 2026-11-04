import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readCustomerOrders } from "@/lib/customer-orders-read";
import { customerOrdersQuerySchema } from "@/lib/validations/collection-query";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
import { serviceUnavailable } from "@/lib/observability";
import { getCurrentUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import UserOrdersClient from "./user-orders-client";
import { customerShipment } from "@/lib/fulfillments";
import { purchasedProduct } from "@/lib/purchase-product-label";

export const dynamic = "force-dynamic";

export default async function CustomerOrdersPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  let actor;
  try { actor = await getCurrentUser(); } catch (error) { throw serviceUnavailable("customer.session", error); }
  if (!actor) redirect("/login");
  const parsed = customerOrdersQuerySchema.safeParse(searchParams ? await searchParams : {});
  if (!parsed.success) return <main className="p-6 space-y-3"><h1>My Order History</h1><p role="alert">Check the search, status filter and page number.</p><Link href="/user/orders">Reset order filters</Link></main>;
  const query = parsed.data;
  const pageHref = (page: number) => `/user/orders?${new URLSearchParams({ q: query.q, status: query.status, page: String(page) })}`;
  let result;
  try { result = await readCustomerOrders(actor, query); }
  catch (error) {
    if (error instanceof ReadAccessError) redirect("/login");
    if (error instanceof ReadPageError) return <main className="p-6 space-y-3"><h1>My Order History</h1><p role="alert">{error.message}</p><Link href={pageHref(1)}>Load the first order page</Link></main>;
    throw error;
  }
  const { orders, user: currentUser, counts, page, totalPages, total } = result;

  const serializedOrders = orders.map((o) => ({
    id: o.id,
    total: Number(o.total),
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    refundState: o.refundState, refundedAmount: Number(o.refundedCents) / 100, disputeStatus: o.disputeStatus, disputeLossAmount: Number(o.disputeAmountCents) / 100,
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
        name: purchasedProduct(i).name,
        imageUrl: i.product.imageUrl,
        slug: purchasedProduct(i).slug!,
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
      <UserOrdersClient key={`${actor.id}:${query.q}:${query.status}:${page}`} user={currentUser} initialOrders={serializedOrders} query={query} counts={counts} />
      <nav aria-label="Order history pages" className="flex flex-wrap items-center gap-4">
        <p>Page {page} of {totalPages}; {total} matching orders.</p>
        {page > 1 && <Link href={pageHref(page - 1)} className="underline">Previous orders</Link>}
        {page < totalPages && <Link href={pageHref(page + 1)} className="underline">Next orders</Link>}
      </nav>
    </div>
  );
}
