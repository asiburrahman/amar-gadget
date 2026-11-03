import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { notificationInboxPath } from "@/lib/notification-policy";
import { NotificationInboxConsole } from "./notification-inbox";
export async function renderNotificationInbox(role: "USER" | "MEMBER" | "ADMIN") {
  const actor = await getCurrentUserWithRole(["USER", "MEMBER", "ADMIN"]); if (!actor) redirect("/login");
  if (actor.role !== role) redirect(notificationInboxPath(actor.role));
  return <main className="mx-auto max-w-6xl space-y-5 p-6"><h1 className="text-3xl font-bold">{role === "ADMIN" ? "Administrator" : role === "MEMBER" ? "Seller" : "Customer"} notifications</h1><NotificationInboxConsole ownerId={actor.id} ownerRole={role} /></main>;
}
