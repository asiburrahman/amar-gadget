import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DashboardAccessError, readCustomerDashboard } from "@/lib/dashboard-metrics";
import CustomerDashboardClient from "./customer-dashboard-client";
import { serviceUnavailable } from "@/lib/observability";
export const dynamic = "force-dynamic";
export default async function CustomerDashboardPage() {
  let actor;
  try { actor = await getCurrentUser(); } catch (error) { throw serviceUnavailable("customer.session", error); }
  if (!actor) redirect("/login");
  let snapshot;
  try { snapshot = await readCustomerDashboard(actor); } catch (error) {
    if (error instanceof DashboardAccessError) redirect("/login");
    throw serviceUnavailable("customer.metrics", error);
  }
  return <main className="min-h-screen space-y-6 p-6 md:p-10"><h1 className="text-3xl font-bold">Customer Dashboard</h1><CustomerDashboardClient snapshot={snapshot} /></main>;
}
