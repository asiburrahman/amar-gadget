import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { SupportContactSettingsConsole } from "@/components/support/contact-settings";
export default async function SupportContactSettingsPage() {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) redirect("/login");
  return <main className="mx-auto max-w-5xl space-y-5 p-6"><h1 className="text-3xl font-bold">Public support contact settings</h1><SupportContactSettingsConsole ownerId={actor.id} /></main>;
}
