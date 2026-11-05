import Link from "next/link";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Access unavailable | Amar Gadget", robots: { index: false, follow: false } };
const dashboards: Record<string, string> = { ADMIN: "/admin", MEMBER: "/member/dashboard", USER: "/user/dashboard" };

export default async function UnauthorizedPage() {
  const actor = await getCurrentUser(), destination = actor ? dashboards[actor.role] : undefined;
  return <main className="mx-auto max-w-xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">This account cannot access that area</h1>
    <p>{actor ? "The requested area requires different account permissions. Use your own dashboard or contact support if you need help with access." : "Sign in with the account that has permission to access the requested area."}</p>
    <nav className="flex flex-wrap gap-4">
      {destination && <Link href={destination} className="underline">Open your dashboard</Link>}
      <Link href="/login" className="underline">Sign in</Link>
      <Link href="/products" className="underline">Browse products</Link>
      <Link href="/contact" className="underline">Contact support</Link>
    </nav>
  </main>;
}
