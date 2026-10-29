import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import Link from "next/link";

export default async function MemberLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUserWithRole(["MEMBER", "ADMIN"]))) {
    redirect("/login");
  }
  return <><nav aria-label="Seller management" className="container mx-auto px-4 flex gap-4"><Link href="/member/dashboard">Seller dashboard</Link><Link href="/member/products">Manage product images</Link><Link href="/member/add-product">Add product</Link></nav>{children}</>;
}
