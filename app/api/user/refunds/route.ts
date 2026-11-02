import { NextResponse } from "next/server";
import { readRefundOrder } from "@/lib/refunds";
import { refundQuerySchema } from "@/lib/validations/refund";
import { refundActor, refundFailure, refundHeaders } from "@/lib/refund-request";
import { RefundError } from "@/lib/refund-policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await refundActor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new RefundError("Use each refund query field once.", "REFUND_REQUEST", 400);
    const query = refundQuerySchema.parse(Object.fromEntries(params));
    return NextResponse.json({ success: true, ...await readRefundOrder(actor, query.orderId, query.page, query.cursor, query.requestId) }, { headers: refundHeaders });
  } catch (error) { return refundFailure(error); }
}
