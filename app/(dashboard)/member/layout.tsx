import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import Link from "next/link";

export default async function MemberLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUserWithRole(["MEMBER", "ADMIN"]))) {
    redirect("/login");
  }
  return <><nav aria-label="Seller management" className="container mx-auto px-4 flex flex-wrap gap-4"><Link href="/member/dashboard">Seller dashboard</Link><Link href="/member/products">Manage catalog</Link><Link href="/member/orders">My shipments</Link><Link href="/member/earnings">Earnings and holds</Link><Link href="/member/payouts">Payouts</Link><Link href="/member/analytics">Settlement analytics</Link><Link href="/member/add-product">Add product</Link></nav>{children}</>;
}
