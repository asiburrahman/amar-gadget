import { redirect } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { NotificationQueueConsole } from "@/components/notifications/notification-queue";
export const dynamic = "force-dynamic";
export default async function NotificationDeliveryPage() {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) redirect("/login");
  return <main className="mx-auto max-w-7xl space-y-5 p-6"><h1 className="text-3xl font-bold">Notification delivery and recovery</h1><NotificationQueueConsole ownerId={actor.id} /></main>;
}
