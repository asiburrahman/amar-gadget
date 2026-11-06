import { formatCurrency } from "@/lib/formatter";
export type RefundSummaryValue = { refundState?: string; refundedAmount?: number; disputeStatus?: string; disputeLossAmount?: number };
export function RefundSummary({ refundState = "NONE", refundedAmount = 0, disputeStatus = "NONE", disputeLossAmount = 0 }: RefundSummaryValue) {
  if (refundState === "NONE" && !refundedAmount && disputeStatus === "NONE") return null;
  return <section aria-label="Refund summary" className="space-y-1 rounded border p-3 text-sm"><p>Refund status: <strong>{refundState.toLowerCase()}</strong></p><p>Confirmed refunds: {formatCurrency(refundedAmount)}</p>{disputeStatus !== "NONE" && <p>Payment dispute: {disputeStatus.toLowerCase()}{disputeLossAmount ? ` · Confirmed disputed loss: ${formatCurrency(disputeLossAmount)}` : ""}</p>}{refundState === "PENDING" && <p>A refund is being processed. Only confirmed transfers are included in the returned amount.</p>}{refundState === "REVIEW" && <p>The payment requires financial reconciliation. Contact support using this order reference.</p>}</section>;
}
