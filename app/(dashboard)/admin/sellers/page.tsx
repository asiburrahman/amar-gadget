import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!await getCurrentUserWithRole(["ADMIN"])) redirect("/login");
  redirect("/admin/members");
}
