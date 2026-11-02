"use client";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/formatter";
import { fulfillmentStatusLabel } from "@/lib/fulfillment-policy";
import { RefundSummary } from "@/components/orders/refund-summary";
import type { CustomerDashboard } from "@/lib/dashboard-metrics";

export default function CustomerDashboardClient({ snapshot }: { snapshot: CustomerDashboard }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading your account...</p>;
  if (!user || user.id !== snapshot.ownerId || user.role !== snapshot.ownerRole) return <p>Reload the dashboard with the matching account.</p>;
  const { metrics, profile, recent } = snapshot;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Welcome back, {profile.name || "Customer"}!</h2><p className="text-sm text-muted-foreground">Your account&apos;s orders and confirmed payments across all time.</p></div><nav className="flex flex-wrap gap-4"><Link className="underline" href="/user/orders">All My Orders ({metrics.totalOrders})</Link><Link className="underline" href="/user/profile">Profile &amp; Settings</Link></nav></header>
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Total Orders Placed" value={String(metrics.totalOrders)} detail="All orders placed by this account, including cancelled orders." />
      <Metric label="Orders Awaiting Completion" value={String(metrics.activeOrders)} detail="Pending payment, processing and partially shipped/delivered orders." />
      <Metric label="Net Paid Order Value" value={formatCurrency(metrics.netPaidCents / 100)} detail="Fully paid orders, less confirmed refunds and lost chargebacks; includes shipping." />
      <Metric label="Delivered Order Payments" value={formatCurrency(metrics.deliveredPaidCents / 100)} detail="Net payments for fully delivered, fully paid orders; includes shipping." />
    </dl>
    {metrics.partiallyCollectedCodOrders > 0 && <p role="status">{metrics.partiallyCollectedCodOrders} COD orders have only some shipments collected. Their money is excluded from paid-order totals until the entire order is paid.</p>}
    {metrics.reviewOrders > 0 && <p role="status">{metrics.reviewOrders} orders have a pending refund, financial review or dispute. Payment figures deduct confirmed returned money only; open disputes and pending refunds may change them later.</p>}
    <section className="space-y-4 rounded-xl border p-5" aria-label="Recent orders"><div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">Recent Orders</h2><Link className="underline" href="/user/orders">View all {metrics.totalOrders} orders</Link></div><p className="text-sm text-muted-foreground">Showing the latest {recent.length} orders. All-time cards include every order.</p>
      {!recent.length ? <div className="space-y-2"><p>You have not placed an order yet.</p><Link href="/products" className="underline">Browse products</Link></div> : <ol className="divide-y">{recent.map((order) => <li key={order.id} className="space-y-2 py-4"><div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold underline" href={`/order-success/${encodeURIComponent(order.id)}`}>Order #{order.id.slice(0, 8)}</Link><span>{fulfillmentStatusLabel(order.status)}</span><span>Original amount: {formatCurrency(order.total)}</span></div><p className="text-sm"><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleDateString("en-BD", { timeZone: "Asia/Dhaka" })}</time> · Payment: {order.paymentStatus.toLowerCase()}</p><RefundSummary {...order} /><ul className="text-sm">{order.items.map((item) => <li key={item.id}>{item.product.name} × {item.quantity}</li>)}</ul>{order.itemLines > order.items.length && <p className="text-sm">{order.itemLines - order.items.length} more item lines in the order details.</p>}</li>)}</ol>}
    </section>
  </div>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="space-y-2 rounded-xl border p-5"><dt className="text-sm font-semibold">{label}</dt><dd className="text-2xl font-bold">{value}</dd><p className="text-xs text-muted-foreground">{detail}</p></div>;
}
