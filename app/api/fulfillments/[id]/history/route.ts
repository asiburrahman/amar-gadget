import { NextResponse } from "next/server";
import { z } from "zod";
import { readFulfillmentHistory } from "@/lib/fulfillments";
import { fulfillmentActor, fulfillmentFailure, fulfillmentPrivateHeaders, fulfillmentQuery } from "@/lib/fulfillment-request";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await fulfillmentActor(request), { id } = await params;
    const parsed = z.object({ id: z.string().uuid(), cursor: z.string().uuid().optional() }).strict().parse({ ...fulfillmentQuery(request), id });
    return NextResponse.json({ success: true, ...await readFulfillmentHistory(actor, parsed.id, parsed.cursor) }, { headers: fulfillmentPrivateHeaders });
  } catch (error) { return fulfillmentFailure(error); }
}
