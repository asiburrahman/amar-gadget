import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { SupportConsole } from "@/components/support/support-console";
import Link from "next/link";

export default async function SupportPage() {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) redirect("/login");
  return <main className="mx-auto max-w-6xl space-y-5 p-6"><h1 className="text-3xl font-bold">Support inquiries</h1><Link href="/admin/settings/support" className="underline">Manage public support contact details</Link><SupportConsole ownerId={actor.id} /></main>;
}
