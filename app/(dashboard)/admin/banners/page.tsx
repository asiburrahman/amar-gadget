import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { BannerConsole } from "@/components/admin/banner-console";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-6xl space-y-6 p-6"><h1 className="text-3xl font-bold">Admin Banners</h1><BannerConsole ownerId={actor.id} /></main>;
}
