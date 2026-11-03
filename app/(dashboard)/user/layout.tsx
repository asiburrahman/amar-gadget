import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import Link from "next/link";
import { notificationInboxPath } from "@/lib/notification-policy";

export default async function UserLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await getCurrentUser();
  if (!actor) {
    redirect("/login");
  }
  return <><nav aria-label="Account navigation" className="container mx-auto px-4 flex flex-wrap gap-4"><Link href="/user/dashboard">My account</Link><Link href="/user/orders">My orders</Link><Link href={notificationInboxPath(actor.role)}>Notifications</Link></nav>{children}</>;
}
