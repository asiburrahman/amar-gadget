import { Metadata } from "next";
import Link from "next/link";
import { H1, H2, P } from "@/components/ui/typography";
import { StatNumericCard } from "@/components/dashboard/stat-numeric-card";
import { formatCurrency } from "@/lib/formatter";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Customer Dashboard | Amar Gadget",
    description: "Manage your account, view order history, and track delivery status.",
  };
}

export default function UserDashboardPage() {
  const recentOrders = [
    { id: "AG-10492", date: "Aug 11, 2026", total: 165000, status: "Delivered", items: "iPhone 16 Pro Max 256GB" },
    { id: "AG-10381", date: "Jul 24, 2026", total: 38500, status: "Processing", items: "Sony WH-1000XM5 Headphones" },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-primary">Customer Portal</span>
        <H1 className="text-3xl font-extrabold">Welcome Back, Customer!</H1>
        <P className="text-sm text-muted-foreground">Track your active orders, browse saved wishlist items, and manage addresses.</P>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatNumericCard title="Total Orders" value="12" change="2 this month" isPositive={true} description="Lifetime order history" />
        <StatNumericCard title="Wishlist Items" value="5" change="Saved" isPositive={true} description="Items ready to buy" />
        <StatNumericCard title="Total Spent" value="৳203,500" change="Verified" isPositive={true} description="Lifetime purchases" />
        <StatNumericCard title="Saved Addresses" value="2" change="Default BD" isPositive={true} description="Dhaka & Chittagong" />
      </div>

      {/* Recent Orders */}
      <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <H2 className="text-lg font-bold border-b-0 pb-0">Recent Orders</H2>
          <Link href="/user/orders" className="text-xs font-bold text-primary hover:underline">
            View All Orders →
          </Link>
        </div>

        <div className="space-y-3">
          {recentOrders.map((order) => (
            <div key={order.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-border bg-muted/20 gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">{order.id}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${order.status === "Delivered" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{order.items} • {order.date}</p>
              </div>

              <div className="text-right">
                <span className="font-extrabold text-sm text-foreground">{formatCurrency(order.total)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}