import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { ReportConsole } from "@/components/admin/report-console";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-7xl space-y-6 p-6"><h1 className="text-3xl font-bold">Order cohort reports</h1><ReportConsole ownerId={actor.id} /></main>;
}
