import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { AccountConsole } from "@/components/admin/account-console";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-7xl space-y-6 p-6"><h1 className="text-3xl font-bold">Seller members</h1><AccountConsole ownerId={actor.id} scope="members" /></main>;
}
