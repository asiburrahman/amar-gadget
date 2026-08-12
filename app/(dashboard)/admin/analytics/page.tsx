import { Metadata } from "next";
import Link from "next/link";
import { H1, H2, P } from "@/components/ui/typography";
import { StatNumericCard } from "@/components/dashboard/stat-numeric-card";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Admin Analytics & Control | Amar Gadget",
    description: "Platform analytics, vendor moderation queue, system performance, and sales oversight.",
  };
}

export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-transparent border border-rose-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Super Admin Control</span>
          <H1 className="text-3xl font-extrabold">Platform System Overview</H1>
          <P className="text-sm text-muted-foreground">Monitor marketplace activity, approve pending seller listings, and manage system users.</P>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatNumericCard title="Total Platform Volume" value="৳8.45M" change="24.2%" isPositive={true} description="YTD Gross Merchandise Value" />
        <StatNumericCard title="Registered Users" value="12,450" change="1,200 new" isPositive={true} description="Customers & Vendors" />
        <StatNumericCard title="Pending Approvals" value="8" change="Action Needed" isPositive={false} description="Product approval queue" />
        <StatNumericCard title="System Health" value="99.98%" change="100% Uptime" isPositive={true} description="API & DB status" />
      </div>

      {/* Admin Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Link href="/admin/products" className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all space-y-2">
          <div className="text-2xl">🔍</div>
          <h3 className="font-bold text-base text-foreground">Product Moderation</h3>
          <p className="text-xs text-muted-foreground">Approve or reject pending product listings submitted by sellers.</p>
        </Link>

        <Link href="/admin/users" className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all space-y-2">
          <div className="text-2xl">👥</div>
          <h3 className="font-bold text-base text-foreground">User Management</h3>
          <p className="text-xs text-muted-foreground">Manage user roles, ban suspicious accounts, and inspect permissions.</p>
        </Link>

        <Link href="/admin/reports" className="p-6 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all space-y-2">
          <div className="text-2xl">📊</div>
          <h3 className="font-bold text-base text-foreground">Financial Reports</h3>
          <p className="text-xs text-muted-foreground">Inspect platform commission revenue and payment gateway reconciliation.</p>
        </Link>
      </div>
    </div>
  );
}