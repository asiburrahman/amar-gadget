import { FulfillmentConsole } from "@/components/orders/fulfillment-console";
export const dynamic = "force-dynamic";
export default function SellerOrdersPage() {
  return <main className="space-y-6 p-6"><h1 className="text-2xl font-bold">My seller shipments</h1><p>Manage your packages independently, including orders shared with other vendors. Administrators confirm delivery and COD receipt.</p><FulfillmentConsole role="MEMBER" /></main>;
}
