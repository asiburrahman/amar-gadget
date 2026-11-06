import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { SettlementConsole } from "./settlement-console";
export async function renderSellerSettlementPage(title: string, mode: "overview" | "shipments" | "payouts") {
  const actor = await getCurrentUserWithRole(["MEMBER", "ADMIN"]);
  if (!actor) redirect("/login");
  if (actor.role === "ADMIN") redirect("/admin/settlements");
  if (actor.sellerStatus !== "APPROVED") return <main className="p-6"><h1>Seller account status</h1><p>Settlement access is available after seller approval.</p></main>;
  return <main className="mx-auto max-w-7xl space-y-5 p-6"><h1 className="text-3xl font-bold">{title}</h1><SettlementConsole ownerId={actor.id} ownerRole="MEMBER" initialMode={mode} /></main>;
}
