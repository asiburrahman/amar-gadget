import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) {
    redirect("/login");
  }
  return children;
}
