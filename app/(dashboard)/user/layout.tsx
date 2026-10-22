import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function UserLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUser())) {
    redirect("/login");
  }
  return children;
}
