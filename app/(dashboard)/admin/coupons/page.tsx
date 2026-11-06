import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { CouponConsole } from "@/components/admin/coupon-console";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-6xl space-y-6 p-6"><h1 className="text-3xl font-bold">Admin Coupons</h1><CouponConsole ownerId={actor.id} /></main>;
}
