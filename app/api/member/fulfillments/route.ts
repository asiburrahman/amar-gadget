import { NextResponse } from "next/server";
import { readAccountJson } from "@/lib/account-request";
import { readSellerFulfillments, mutateFulfillment } from "@/lib/fulfillments";
import { fulfillmentActor, fulfillmentFailure, fulfillmentPrivateHeaders, fulfillmentQuery, invalidateFulfillmentPages } from "@/lib/fulfillment-request";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return NextResponse.json({ success: true, ...await readSellerFulfillments(await fulfillmentActor(request, false, "MEMBER"), fulfillmentQuery(request)) }, { headers: fulfillmentPrivateHeaders }); }
  catch (error) { return fulfillmentFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await fulfillmentActor(request, true, "MEMBER"), saved = await mutateFulfillment(actor, await readAccountJson(request));
    invalidateFulfillmentPages(saved.shipment.orderId);
    return NextResponse.json({ success: true, ...saved }, { headers: fulfillmentPrivateHeaders });
  } catch (error) { return fulfillmentFailure(error); }
}
