import { renderNotificationInbox } from "@/components/notifications/notification-page";
export const dynamic = "force-dynamic";
export default async function AdministratorNotificationsPage() { return renderNotificationInbox("ADMIN"); }
