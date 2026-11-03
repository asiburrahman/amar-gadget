import { FulfillmentConsole } from "@/components/orders/fulfillment-console";
import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
export const dynamic = "force-dynamic";
export default async function SellerOrdersPage() {
  const actor = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
  if (!actor) redirect("/login");
  if (actor.role === "ADMIN") redirect("/admin/orders");
  if (actor.sellerStatus !== "APPROVED") return <main className="p-6"><h1>Seller account status</h1><p>Shipment management is available after approval.</p></main>;
  return <main className="space-y-6 p-6"><h1 className="text-2xl font-bold">My seller shipments</h1><p>Manage your packages independently, including orders shared with other vendors. Administrators confirm delivery and COD receipt.</p><FulfillmentConsole role="MEMBER" /></main>;
}
