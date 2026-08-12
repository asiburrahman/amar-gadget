import { Metadata } from "next";
import Link from "next/link";
import { H1, H2, P } from "@/components/ui/typography";
import { StatNumericCard } from "@/components/dashboard/stat-numeric-card";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Vendor Dashboard | Amar Gadget",
    description: "Manage product listings, track sales revenue, and fulfill customer orders.",
  };
}

export default function MemberDashboardPage() {
  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-500/10 via-indigo-500/5 to-transparent border border-purple-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">Seller / Vendor Portal</span>
          <H1 className="text-3xl font-extrabold">Vendor Command Center</H1>
          <P className="text-sm text-muted-foreground">Manage inventory, check payout earnings, and submit new products for admin approval.</P>
        </div>

        <Link
          href="/member/add-product"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors shrink-0"
        >
          + Add New Product
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatNumericCard title="Total Revenue" value="৳1,240,000" change="18.4%" isPositive={true} description="Gross sales this month" />
        <StatNumericCard title="Active Listings" value="38" change="4 pending" isPositive={true} description="Published in store" />
        <StatNumericCard title="Orders to Ship" value="14" change="High Priority" isPositive={true} description="Awaiting dispatch" />
        <StatNumericCard title="Vendor Rating" value="4.9 ★" change="98% positive" isPositive={true} description="Based on 450 reviews" />
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Link href="/member/products" className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all space-y-2">
          <div className="text-2xl">📦</div>
          <h3 className="font-bold text-base text-foreground">Manage Products</h3>
          <p className="text-xs text-muted-foreground">View stock levels, update pricing, and check approval status.</p>
        </Link>

        <Link href="/member/orders" className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all space-y-2">
          <div className="text-2xl">🚚</div>
          <h3 className="font-bold text-base text-foreground">Fulfill Orders</h3>
          <p className="text-xs text-muted-foreground">Download shipping labels and update customer tracking IDs.</p>
        </Link>

        <Link href="/member/payouts" className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all space-y-2">
          <div className="text-2xl">💰</div>
          <h3 className="font-bold text-base text-foreground">Earnings & Payouts</h3>
          <p className="text-xs text-muted-foreground">Request bank payouts and view transaction statements.</p>
        </Link>
      </div>
    </div>
  );
}