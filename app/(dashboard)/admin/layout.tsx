import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    redirect("/login");
  }
  return <><nav aria-label="Administrator operations" className="container mx-auto px-4 flex flex-wrap gap-4"><Link href="/admin/settlements">Seller settlement and payouts</Link><Link href="/admin/reports">Order reports</Link><Link href="/admin/notifications">Notifications</Link><Link href="/admin/support">Support inquiries</Link></nav>{children}</>;
}
