import { NextResponse } from "next/server";
import { readAccountJson } from "@/lib/account-request";
import { mutateRefundLocally, readRefundOrder } from "@/lib/refunds";
import { processCardRefund, recoverMissingRefund } from "@/lib/stripe/refunds";
import { refundActionSchema, refundQuerySchema } from "@/lib/validations/refund";
import { refundActor, refundFailure, refundHeaders, invalidateRefundPages } from "@/lib/refund-request";
import { RefundError } from "@/lib/refund-policy";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const actor = await refundActor(request, false, true), params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new RefundError("Use each refund query field once.", "REFUND_REQUEST", 400);
    const query = refundQuerySchema.parse(Object.fromEntries(params));
    return NextResponse.json({ success: true, ...await readRefundOrder(actor, query.orderId, query.page, query.cursor, query.requestId) }, { headers: refundHeaders });
  } catch (error) { return refundFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await refundActor(request, true, true), data = refundActionSchema.parse(await readAccountJson(request));
    const saved = data.action === "process" ? await processCardRefund(data.refundId, actor, data.version) : data.action === "recover-missing" ? await recoverMissingRefund(data.refundId, actor, data.version, data.evidence) : await mutateRefundLocally(actor, data);
    if (data.action !== "quote") invalidateRefundPages(saved.orderId);
    return NextResponse.json({ success: true, ...saved, ownerId: actor.id }, { status: data.action === "request" ? 201 : 200, headers: refundHeaders });
  } catch (error) { return refundFailure(error); }
}
