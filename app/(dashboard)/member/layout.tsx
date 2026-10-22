import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";

export default async function MemberLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUserWithRole(["MEMBER", "ADMIN"]))) {
    redirect("/login");
  }
  return children;
}
