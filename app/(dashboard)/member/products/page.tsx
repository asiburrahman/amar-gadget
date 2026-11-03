import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductMaintenanceConsole } from "@/components/catalog/product-maintenance-console";
import { getCurrentUserWithRole } from "@/lib/session";
import { campaignPageSchema } from "@/lib/validations/campaign";
export const dynamic = "force-dynamic";
export default async function MemberProductsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getCurrentUserWithRole(["MEMBER", "ADMIN"]); if (!actor) redirect("/login");
  if (actor.role === "MEMBER" && actor.sellerStatus !== "APPROVED") return <main className="p-6"><h1>Seller account status</h1><p>Catalog management is available after approval.</p></main>;
  const parsed = campaignPageSchema.safeParse((searchParams ? await searchParams : {}).page);
  if (!parsed.success) return <main className="p-6"><p role="alert">Invalid page. <Link href="/member/products">Reset page</Link></p></main>;
  return <main className="max-w-6xl mx-auto p-6 space-y-4"><h1 className="text-2xl font-bold">Your product catalog</h1><ProductMaintenanceConsole ownerId={actor.id} ownerRole={actor.role as "MEMBER" | "ADMIN"} initialPage={parsed.data} /></main>;
}
