import { prisma } from "@/lib/prisma";
/** Capture truth remains PAID after reimbursement, so duplicate payment
 * webhooks cannot resurrect money. Reporting deducts the retained ledger. */
export async function netCollectedRevenue() {
  const [row] = await prisma.$queryRaw<{ amount: string }[]>`
    SELECT COALESCE(sum(GREATEST(0,total-"refundedCents"::numeric/100-"disputeAmountCents"::numeric/100)),0)::text AS amount
    FROM "Order" WHERE "paymentStatus"='PAID'`;
  const result = Number(row.amount);
  if (!Number.isFinite(result) || result < 0 || result * 100 > Number.MAX_SAFE_INTEGER) throw new Error("Financial aggregate exceeds the supported display range");
  return result;
}
