import { NextResponse } from "next/server";
import { readAccountJson } from "@/lib/account-request";
import { readNotifications, mutateNotifications } from "@/lib/notifications";
import { notificationActor, notificationQuery, notificationHeaders, notificationFailure } from "@/lib/notification-request";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const actor = await notificationActor(request); return NextResponse.json({ success: true, ...await readNotifications(actor, notificationQuery(request)) }, { headers: notificationHeaders }); }
  catch (error) { return notificationFailure(error); }
}
export async function POST(request: Request) {
  try { const actor = await notificationActor(request, true); return NextResponse.json({ success: true, ...await mutateNotifications(actor, await readAccountJson(request)) }, { headers: notificationHeaders }); }
  catch (error) { return notificationFailure(error); }
}
