import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { NewsletterAdministrationConsole } from "@/components/newsletter/administration";
export default async function NewsletterAdministrationPage() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-6xl space-y-5 p-6"><h1 className="text-3xl font-bold">Newsletter consent and delivery</h1><NewsletterAdministrationConsole ownerId={actor.id} /></main>;
}
