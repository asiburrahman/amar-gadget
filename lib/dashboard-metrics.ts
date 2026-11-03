import { Prisma } from "@prisma/client";
import { purchasedProduct } from "@/lib/purchase-product-label";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";

export class DashboardAccessError extends Error {}
function integer(value: string | bigint | number) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Dashboard aggregate exceeds the supported range");
  return amount;
}
async function snapshot<T>(actor: AuthenticatedUser, seller: boolean, read: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
    const saved = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true, sellerStatus: true } });
    if (!saved?.isVerified || saved.role !== actor.role || saved.sessionVersion !== actor.sessionVersion || (seller && (saved.role !== "MEMBER" || saved.sellerStatus !== "APPROVED"))) throw new DashboardAccessError("Reload the dashboard with the matching approved account.");
    return read(tx);
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 3000 });
}

export async function readCustomerDashboard(actor: AuthenticatedUser) {
  return snapshot(actor, false, async (tx) => {
    const [row] = await tx.$queryRaw<{ total: string; active: string; paid: string; delivered: string; review: string; partialCod: string }[]>`
      SELECT count(*)::text AS total,
        count(*) FILTER(WHERE status NOT IN ('DELIVERED','CANCELLED'))::text AS active,
        COALESCE(sum(GREATEST(0,(total*100)::numeric-"refundedCents"-"disputeAmountCents")) FILTER(WHERE "paymentStatus"='PAID'),0)::text AS paid,
        COALESCE(sum(GREATEST(0,(total*100)::numeric-"refundedCents"-"disputeAmountCents")) FILTER(WHERE "paymentStatus"='PAID' AND status='DELIVERED'),0)::text AS delivered,
        count(*) FILTER(WHERE "financialReviewReason" IS NOT NULL OR "reservationReviewReason" IS NOT NULL OR "disputeStatus" IN ('ACTIVE','LOST') OR "refundState" IN ('PENDING','REVIEW'))::text AS review,
        count(*) FILTER(WHERE "paymentMethod"='COD' AND "paymentStatus"<>'PAID' AND EXISTS(SELECT 1 FROM "OrderFulfillment" f WHERE f."orderId"="Order".id AND f."codCollected"))::text AS "partialCod"
      FROM "Order" WHERE "userId"=${actor.id}`;
    const profile = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true, email: true } });
    const recent = await tx.order.findMany({ where: { userId: actor.id }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10,
      select: { id: true, total: true, status: true, paymentStatus: true, refundState: true, refundedCents: true, disputeStatus: true, disputeAmountCents: true, createdAt: true, _count: { select: { items: true } },
        items: { take: 3, orderBy: { id: "asc" }, select: { id: true, quantity: true, productName: true, product: { select: { name: true } } } } } });
    return { ownerId: actor.id, ownerRole: actor.role, profile,
      metrics: { totalOrders: integer(row.total), activeOrders: integer(row.active), netPaidCents: integer(row.paid), deliveredPaidCents: integer(row.delivered), reviewOrders: integer(row.review), partiallyCollectedCodOrders: integer(row.partialCod) },
      recent: recent.map(({ total, refundedCents, disputeAmountCents, createdAt, _count, ...order }) => ({ ...order, items: order.items.map(({ productName, ...item }) => ({ ...item, product: purchasedProduct({ ...item, productName }) })), total: Number(total), refundedAmount: integer(refundedCents) / 100, disputeLossAmount: integer(disputeAmountCents) / 100, createdAt: createdAt.toISOString(), itemLines: _count.items })) };
  });
}
export type CustomerDashboard = Awaited<ReturnType<typeof readCustomerDashboard>>;

export function dashboardYear(input?: string | string[], now = new Date()) {
  const current = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Dhaka", year: "numeric" }).format(now));
  if (input === undefined) return current;
  if (typeof input !== "string" || !/^\d{4}$/.test(input) || Number(input) < 2000 || Number(input) > current) return null;
  return Number(input);
}
const sellerLines = (ownerId: string) => Prisma.sql`
  SELECT i."orderId",i."retainedQuantity",i."retainedCents",i."netCents",f.status,
    to_char(o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka','YYYY-MM') AS month,
    o.status<>'CANCELLED' AND f.status<>'CANCELLED' AS active,
    (o."paymentMethod"='STRIPE' AND o."paymentStatus"='PAID') OR (o."paymentMethod"='COD' AND f."codCollected") AS paid,
    o."financialReviewReason" IS NULL AND o."reservationReviewReason" IS NULL AND o."disputeStatus" IN ('NONE','WON') AS clear
  FROM "OrderItem" i JOIN "OrderFulfillment" f ON f.id=i."fulfillmentId" JOIN "Order" o ON o.id=i."orderId"
  WHERE f."sellerId"=${ownerId}`;

export async function readSellerDashboardMetrics(actor: AuthenticatedUser, year: number) {
  if (dashboardYear(String(year)) !== year) throw new Error("Invalid dashboard year");
  return snapshot(actor, true, async (tx) => {
    const base = sellerLines(actor.id);
    const [row] = await tx.$queryRaw<{ orders: string; pending: string; paid: string; delivered: string; units: string; excluded: string; firstMonth: string | null }[]>(Prisma.sql`
      WITH lines AS (${base}) SELECT count(DISTINCT "orderId")::text AS orders,
        count(DISTINCT "orderId") FILTER(WHERE active AND status NOT IN ('DELIVERED','CANCELLED') AND "retainedQuantity">0)::text AS pending,
        COALESCE(sum("retainedCents") FILTER(WHERE active AND paid AND clear),0)::text AS paid,
        COALESCE(sum("retainedCents") FILTER(WHERE active AND paid AND clear AND status='DELIVERED'),0)::text AS delivered,
        COALESCE(sum("retainedQuantity") FILTER(WHERE active AND paid AND clear AND status='DELIVERED'),0)::text AS units,
        count(*) FILTER(WHERE active AND paid AND (NOT clear OR "netCents" IS NULL))::text AS excluded,
        min(month) AS "firstMonth" FROM lines`);
    const monthly = await tx.$queryRaw<{ month: string; orders: string; paid: string; delivered: string; units: string; excluded: string }[]>(Prisma.sql`
      WITH lines AS (${base}) SELECT month,count(DISTINCT "orderId")::text AS orders,
        COALESCE(sum("retainedCents") FILTER(WHERE active AND paid AND clear),0)::text AS paid,
        COALESCE(sum("retainedCents") FILTER(WHERE active AND paid AND clear AND status='DELIVERED'),0)::text AS delivered,
        COALESCE(sum("retainedQuantity") FILTER(WHERE active AND paid AND clear AND status='DELIVERED'),0)::text AS units,
        count(*) FILTER(WHERE active AND paid AND (NOT clear OR "netCents" IS NULL))::text AS excluded
      FROM lines WHERE month>=${`${year}-01`} AND month<=${`${year}-12`} GROUP BY month ORDER BY month DESC`);
    return { ownerId: actor.id, year, currentYear: dashboardYear()!, firstYear: row.firstMonth ? Number(row.firstMonth.slice(0, 4)) : year,
      totalOrders: integer(row.orders), pendingOrders: integer(row.pending), paidItemCents: integer(row.paid), deliveredItemCents: integer(row.delivered), deliveredUnits: integer(row.units), excludedLines: integer(row.excluded),
      monthly: monthly.map((entry) => ({ month: entry.month, monthLabel: new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${entry.month}-01T00:00:00Z`)), ordersCount: integer(entry.orders), paidItemCents: integer(entry.paid), deliveredItemCents: integer(entry.delivered), deliveredUnits: integer(entry.units), excludedLines: integer(entry.excluded) })) };
  });
}
export type SellerDashboardMetrics = Awaited<ReturnType<typeof readSellerDashboardMetrics>>;
