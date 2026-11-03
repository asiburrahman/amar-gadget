import { renderNotificationInbox } from "@/components/notifications/notification-page";
export const dynamic = "force-dynamic";
export default async function SellerNotificationsPage() { return renderNotificationInbox("MEMBER"); }
