import { renderNotificationInbox } from "@/components/notifications/notification-page";
export const dynamic = "force-dynamic";
export default async function CustomerNotificationsPage() { return renderNotificationInbox("USER"); }
