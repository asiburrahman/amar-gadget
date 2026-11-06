import { NextResponse } from "next/server";
import { readAccountJson } from "@/lib/account-request";
import { readNotificationQueue, retryNotificationEvent } from "@/lib/notifications";
import { notificationActor, notificationQuery, notificationHeaders, notificationFailure } from "@/lib/notification-request";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const actor = await notificationActor(request, false, true); return NextResponse.json({ success: true, ...await readNotificationQueue(actor, notificationQuery(request)) }, { headers: notificationHeaders }); }
  catch (error) { return notificationFailure(error); }
}
export async function POST(request: Request) {
  try { const actor = await notificationActor(request, true, true); return NextResponse.json({ success: true, ...await retryNotificationEvent(actor, await readAccountJson(request)) }, { headers: notificationHeaders }); }
  catch (error) { return notificationFailure(error); }
}
