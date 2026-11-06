import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { SettlementConsole } from "@/components/settlements/settlement-console";
export const dynamic = "force-dynamic";
export default async function AdministratorSettlementPage() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-7xl space-y-5 p-6"><h1 className="text-3xl font-bold">Seller settlement and payouts</h1><SettlementConsole ownerId={actor.id} ownerRole="ADMIN" /></main>;
}
