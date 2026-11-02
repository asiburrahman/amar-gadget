import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { withAccountAdministrator, AccountAdminError } from "@/lib/account-administration";
import { resolveReportPeriod } from "@/lib/validations/admin-reports";
type Aggregate = { orders: string; gross: string; paid: string; refunds: string; lost: string; net: string; partialCod: string; review: string };
function integer(value: string | number) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error("Report aggregate exceeds the supported range"); return result; }
const aggregation = Prisma.sql`count(*)::text AS orders,COALESCE(sum(total*100),0)::text AS gross,
 COALESCE(sum(total*100) FILTER(WHERE "paymentStatus"='PAID'),0)::text AS paid,
 COALESCE(sum("refundedCents") FILTER(WHERE "paymentStatus"='PAID'),0)::text AS refunds,
 COALESCE(sum("disputeAmountCents") FILTER(WHERE "paymentStatus"='PAID'),0)::text AS lost,
 COALESCE(sum(GREATEST(0,total*100-"refundedCents"-"disputeAmountCents")) FILTER(WHERE "paymentStatus"='PAID'),0)::text AS net,
 count(*) FILTER(WHERE "paymentMethod"='COD' AND "paymentStatus"<>'PAID' AND EXISTS(SELECT 1 FROM "OrderFulfillment" f WHERE f."orderId"=o.id AND f."codCollected"))::text AS "partialCod",
 count(*) FILTER(WHERE "financialReviewReason" IS NOT NULL OR "reservationReviewReason" IS NOT NULL OR "refundState" IN ('PENDING','REVIEW') OR "disputeStatus" IN ('ACTIVE','LOST'))::text AS review`;
const aggregateDto = (row: Aggregate) => ({ orders: integer(row.orders), grossOrderCents: integer(row.gross), paidCaptureCents: integer(row.paid), paidRefundCents: integer(row.refunds), lostDisputeCents: integer(row.lost), netFullyCollectedCents: integer(row.net), partiallyCollectedCodOrders: integer(row.partialCod), reviewOrders: integer(row.review) });
export async function readAdministratorReport(actor: AuthenticatedUser, raw: unknown) {
  const input = resolveReportPeriod(raw), limit = input.format === "csv" ? 5000 : 20;
  return withAccountAdministrator(actor, async (tx) => {
    const where = Prisma.sql`WHERE o."createdAt">=((${input.from}::date)::timestamp AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC'
      AND o."createdAt"<(((${input.to}::date+1)::timestamp AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC')
      ${input.status !== "ALL" ? Prisma.sql`AND o.status=${input.status}` : Prisma.empty}
      ${input.paymentStatus !== "ALL" ? Prisma.sql`AND o."paymentStatus"=${input.paymentStatus}` : Prisma.empty}
      ${input.paymentMethod !== "ALL" ? Prisma.sql`AND o."paymentMethod"=${input.paymentMethod}` : Prisma.empty}
      ${input.customerId ? Prisma.sql`AND o."userId"=${input.customerId}` : Prisma.empty}`;
    const [aggregate] = await tx.$queryRaw<Aggregate[]>(Prisma.sql`SELECT ${aggregation} FROM "Order" o ${where}`), summary = aggregateDto(aggregate), totalPages = Math.max(1, Math.ceil(summary.orders / 20));
    if (input.format === "csv" && summary.orders > limit) throw new AccountAdminError("This export exceeds 5,000 orders. Narrow the date or payment/status filters before exporting.", "ADMIN_EXPORT_LIMIT", 422);
    if (input.page > totalPages || (input.format === "csv" && input.page !== 1)) throw new AccountAdminError("This report page does not exist. Exports require page one.", "ADMIN_REPORT_PAGE", 404);
    const rows = await tx.$queryRaw<{ id: string; userId: string; createdAt: Date; status: string; paymentMethod: string; paymentStatus: string; totalCents: string; refundedCents: string; lostDisputeCents: string; netCents: string | null; review: boolean; collectedShipments: string }[]>(Prisma.sql`
      SELECT o.id,o."userId",o."createdAt",o.status,o."paymentMethod",o."paymentStatus",(o.total*100)::text AS "totalCents",o."refundedCents"::text AS "refundedCents",o."disputeAmountCents"::text AS "lostDisputeCents",
       CASE WHEN o."paymentStatus"='PAID' THEN GREATEST(0,o.total*100-o."refundedCents"-o."disputeAmountCents")::text ELSE NULL END AS "netCents",
       (o."financialReviewReason" IS NOT NULL OR o."reservationReviewReason" IS NOT NULL OR o."refundState" IN ('PENDING','REVIEW') OR o."disputeStatus" IN ('ACTIVE','LOST')) AS review,
       (SELECT count(*) FROM "OrderFulfillment" f WHERE f."orderId"=o.id AND f."codCollected")::text AS "collectedShipments"
      FROM "Order" o ${where} ORDER BY o."createdAt" DESC,o.id ASC LIMIT ${limit} OFFSET ${input.format === "csv" ? 0 : (input.page - 1) * limit}`);
    const daily = await tx.$queryRaw<(Aggregate & { day: string })[]>(Prisma.sql`SELECT to_char(o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS day,${aggregation} FROM "Order" o ${where} GROUP BY day ORDER BY day DESC`);
    return { ownerId: actor.id, filters: input, timezone: "Asia/Dhaka" as const, asOf: new Date().toISOString(), summary, page: input.page, totalPages,
      rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), totalCents: integer(row.totalCents), refundedCents: integer(row.refundedCents), lostDisputeCents: integer(row.lostDisputeCents), netCents: row.netCents === null ? null : integer(row.netCents), collectedShipments: integer(row.collectedShipments) })),
      daily: daily.map((row) => ({ day: row.day, ...aggregateDto(row) })) };
  });
}
export async function readAdministratorOverview(actor: AuthenticatedUser) {
  return withAccountAdministrator(actor, async (tx) => {
    const [counts] = await tx.$queryRaw<{ users: string; customers: string; sellers: string; administrators: string; unverified: string; pendingSellers: string; products: string; pendingProducts: string; orders: string; paidRevenueCents: string }[]>`
      SELECT count(*)::text AS users,count(*) FILTER(WHERE role='USER')::text AS customers,count(*) FILTER(WHERE role='MEMBER')::text AS sellers,
       count(*) FILTER(WHERE role='ADMIN')::text AS administrators,count(*) FILTER(WHERE NOT "isVerified")::text AS unverified,
       count(*) FILTER(WHERE role='MEMBER' AND "sellerStatus"='PENDING')::text AS "pendingSellers",
       (SELECT count(*) FROM "Product")::text AS products,(SELECT count(*) FROM "Product" WHERE status='PENDING_APPROVAL')::text AS "pendingProducts",
       (SELECT count(*) FROM "Order")::text AS orders,
       (SELECT COALESCE(sum(GREATEST(0,total*100-"refundedCents"-"disputeAmountCents")),0) FROM "Order" WHERE "paymentStatus"='PAID')::text AS "paidRevenueCents" FROM "User"`;
    return { ownerId: actor.id, asOf: new Date().toISOString(), ...Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, integer(value)])) } as { ownerId: string; asOf: string } & Record<keyof typeof counts, number>;
  });
}
export function administratorReportCsv(report: Awaited<ReturnType<typeof readAdministratorReport>>) {
  const cell = (value: string | number | boolean | null) => { let text = value === null ? "" : String(value); if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  const money = (value: number) => { const cents = BigInt(value); return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`; };
  const lines: (string | number | boolean | null)[][] = [["order_id", "customer_id", "created_at_utc", "status", "payment_method", "payment_status", "order_total_bdt", "confirmed_refunds_bdt", "lost_disputes_bdt", "net_fully_collected_bdt", "collected_cod_shipments", "review_required", "cohort_from_dhaka", "cohort_to_dhaka", "as_of_utc"],
    ...report.rows.map((row) => [row.id, row.userId, row.createdAt, row.status, row.paymentMethod, row.paymentStatus, money(row.totalCents), money(row.refundedCents), money(row.lostDisputeCents), row.netCents === null ? null : money(row.netCents), row.collectedShipments, row.review, report.filters.from, report.filters.to, report.asOf])];
  return "\uFEFF" + lines.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
export type AdministratorReport = Awaited<ReturnType<typeof readAdministratorReport>>;
