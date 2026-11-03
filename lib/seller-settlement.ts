import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { SettlementError } from "@/lib/settlement-policy";
import { settlementRequestSchema, settlementQuerySchema } from "@/lib/validations/settlement";
async function lockAdministrator(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR NO KEY UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
  if (actor.role !== "ADMIN" || !current?.isVerified || current.role !== "ADMIN" || current.sessionVersion !== actor.sessionVersion) throw new SettlementError("Administrator access changed. Sign in again.", "SETTLEMENT_ACCOUNT_CHANGED", 403);
}
const payoutDto = (row: Prisma.SellerPayoutGetPayload<object>) => ({ ...row, amountCents: row.amountCents.toString(), createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null });
export async function mutateSellerSettlement(actor: AuthenticatedUser, raw: unknown) {
  if (actor.role !== "ADMIN") throw new SettlementError("Only administrators configure settlement or record external payouts.", "SETTLEMENT_FORBIDDEN", 403);
  const parsed = settlementRequestSchema.parse(raw), abandoning = parsed.action === "abandon-request";
  const input = parsed.action === "abandon-request" ? parsed.originalIntent : parsed, hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`amar.settlement.request:${input.requestId}`},0))`;
    // Adoption can change existing earnings. Follow Order -> account -> snapshot
    // before the deferred posting takes seller wallets, as refund writers do.
    if (!abandoning && input.action === "adopt-policy") {
      const snapshot = await tx.sellerSettlementSnapshot.findUnique({ where: { fulfillmentId: input.fulfillmentId }, select: { orderId: true } });
      if (!snapshot) throw new SettlementError("Captured shipment terms were not found.", "SETTLEMENT_NOT_FOUND", 404);
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${snapshot.orderId} FOR UPDATE`;
    }
    await lockAdministrator(tx, actor);
    const prior = await tx.sellerSettlementRequest.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.actorId !== actor.id || prior.hash !== hash) throw new SettlementError("This request identity belongs to different settlement changes.", "SETTLEMENT_REQUEST_CONFLICT");
      return { result: prior.result, replayed: true };
    }
    if (abandoning) {
      const result = { action: "abandoned-request", id: input.requestId, version: 1, originalAction: input.action, status: "ABANDONED" };
      await tx.sellerSettlementRequest.create({ data: { id: input.requestId, actorId: actor.id, hash, result } });
      return { result, replayed: false };
    }
    let result: Prisma.InputJsonObject;
    if (input.action === "save-policy") {
      const scopeKey = input.scope === "GLOBAL" ? "GLOBAL" : `SELLER:${input.sellerId}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`amar.settlement.policy:${scopeKey}`},0))`;
      if (input.sellerId) {
        const seller = await tx.user.findUnique({ where: { id: input.sellerId }, select: { role: true } });
        if (!seller || !["MEMBER", "ADMIN"].includes(seller.role)) throw new SettlementError("Select an existing catalog owner.", "SETTLEMENT_SELLER", 404);
      }
      const current = await tx.sellerSettlementPolicy.findFirst({ where: { scopeKey }, orderBy: { version: "desc" } });
      if ((current?.version ?? 0) !== input.version) throw new SettlementError("This commercial policy changed. Reload its latest revision.", "SETTLEMENT_POLICY_CHANGED");
      if (current && current.commissionBps === (input.terms?.commissionBps ?? null) && current.shippingRecipient === (input.terms?.shippingRecipient ?? null)) throw new SettlementError("The saved commercial policy already has these terms.", "SETTLEMENT_NO_CHANGE", 400);
      const policy = await tx.sellerSettlementPolicy.create({ data: { id: randomUUID(), scopeKey, version: input.version + 1, commissionBps: input.terms?.commissionBps ?? null, shippingRecipient: input.terms?.shippingRecipient ?? null, createdById: actor.id, reason: input.reason } });
      result = { action: input.action, id: policy.id, scopeKey, version: policy.version };
    } else if (input.action === "adopt-policy") {
      await tx.$queryRaw`SELECT "fulfillmentId" FROM "SellerSettlementSnapshot" WHERE "fulfillmentId"=${input.fulfillmentId} FOR UPDATE`;
      const snapshot = await tx.sellerSettlementSnapshot.findUniqueOrThrow({ where: { fulfillmentId: input.fulfillmentId } });
      const actual = await tx.orderFulfillment.findFirst({ where: { id: input.fulfillmentId, orderId: snapshot.orderId, sellerId: snapshot.sellerId, items: { some: {} } }, select: { id: true } });
      if (!actual) throw new SettlementError("The captured seller shipment is no longer available.", "SETTLEMENT_NOT_FOUND", 404);
      if (snapshot.version !== input.version || snapshot.policyId) throw new SettlementError("These shipment terms changed or were already captured. Reload before deciding again.", "SETTLEMENT_POLICY_CHANGED");
      const [effective] = await tx.$queryRaw<{ id: string | null }[]>`SELECT effective_seller_settlement_policy(${snapshot.sellerId}) AS id`;
      if (!effective?.id || effective.id !== input.policyId) throw new SettlementError("Review the currently effective configured policy before adopting it.", "SETTLEMENT_POLICY_CHANGED");
      const saved = await tx.sellerSettlementSnapshot.update({ where: { fulfillmentId: snapshot.fulfillmentId }, data: { policyId: effective.id, version: snapshot.version + 1, adoptedById: actor.id, adoptionReason: input.reason } });
      result = { action: input.action, id: saved.fulfillmentId, version: saved.version, policyId: saved.policyId };
    } else if (input.action === "start-payout") {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${input.sellerId} FOR SHARE`;
      const seller = await tx.user.findUnique({ where: { id: input.sellerId }, select: { role: true, isVerified: true, sellerStatus: true } });
      if (!seller?.isVerified || !["MEMBER", "ADMIN"].includes(seller.role) || seller.sellerStatus !== "APPROVED") throw new SettlementError("Payout requires a current verified, approved catalog owner.", "SETTLEMENT_SELLER", 409);
      await tx.$queryRaw`SELECT "sellerId" FROM "SellerWallet" WHERE "sellerId"=${input.sellerId} FOR UPDATE`;
      const wallet = await tx.sellerWallet.findUnique({ where: { sellerId: input.sellerId } }), amount = BigInt(input.amountCents);
      if (!wallet || wallet.balanceCents < amount) throw new SettlementError("This amount exceeds the current available seller balance.", "SETTLEMENT_BALANCE");
      const payout = await tx.sellerPayout.create({ data: { sellerId: input.sellerId, amountCents: amount, method: input.method, createdById: actor.id, reason: input.reason } });
      result = { action: input.action, id: payout.id, version: payout.version, amountCents: payout.amountCents.toString(), status: payout.status };
    } else {
      await tx.$queryRaw`SELECT id FROM "SellerPayout" WHERE id=${input.payoutId} FOR UPDATE`;
      const current = await tx.sellerPayout.findUnique({ where: { id: input.payoutId } });
      if (!current) throw new SettlementError("Payout instruction was not found.", "SETTLEMENT_NOT_FOUND", 404);
      if (current.version !== input.version || current.status !== "RESERVED") throw new SettlementError("This payout changed or was already resolved. Reload its recorded state.", "SETTLEMENT_PAYOUT_CHANGED");
      if (input.action === "confirm-payout") {
        const duplicate = await tx.sellerPayout.findFirst({ where: { status: "PAID", method: current.method, reference: input.reference.trim().toUpperCase() }, select: { id: true } });
        if (duplicate) throw new SettlementError("That payment method/reference is already recorded for another payout.", "SETTLEMENT_REFERENCE");
      }
      const payout = await tx.sellerPayout.update({ where: { id: current.id }, data: { version: current.version + 1, resolvedById: actor.id, resolutionReason: input.reason, ...(input.action === "confirm-payout" ? { status: "PAID", reference: input.reference } : { status: "CANCELLED", moneyNotSent: true }) } });
      result = { action: input.action, id: payout.id, version: payout.version, status: payout.status, amountCents: payout.amountCents.toString() };
    }
    await tx.sellerSettlementRequest.create({ data: { id: input.requestId, actorId: actor.id, hash, result } });
    return { result, replayed: false };
  }, { timeout: 15_000, maxWait: 5000 });
}
export { payoutDto };

export async function readSellerSettlement(actor: AuthenticatedUser, raw: unknown) {
  const query = settlementQuerySchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true, sellerStatus: true } });
    if (!current?.isVerified || current.role !== actor.role || current.sessionVersion !== actor.sessionVersion || !["MEMBER", "ADMIN"].includes(current.role) || (current.role === "MEMBER" && current.sellerStatus !== "APPROVED")) throw new SettlementError("Settlement account access changed. Sign in again.", "SETTLEMENT_ACCOUNT_CHANGED", 403);
    if (current.role === "MEMBER" && query.sellerId && query.sellerId !== actor.id) throw new SettlementError("Only your own seller settlement is available.", "SETTLEMENT_FORBIDDEN", 403);
    const sellerId = current.role === "MEMBER" ? actor.id : query.sellerId;
    const seller = sellerId ? await tx.user.findFirst({ where: { id: sellerId, role: { in: ["MEMBER", "ADMIN"] } }, select: { id: true, name: true, email: true, sellerStatus: true, isVerified: true } }) : null;
    if (sellerId && !seller) throw new SettlementError("Catalog owner was not found.", "SETTLEMENT_SELLER", 404);
    const scopeKey = sellerId ? `SELLER:${sellerId}` : "GLOBAL";
    const currentPolicy = await tx.sellerSettlementPolicy.findFirst({ where: { scopeKey }, orderBy: { version: "desc" } });
    const globalPolicy = scopeKey === "GLOBAL" ? currentPolicy : await tx.sellerSettlementPolicy.findFirst({ where: { scopeKey: "GLOBAL" }, orderBy: { version: "desc" } });
    const effectivePolicy = currentPolicy && currentPolicy.commissionBps !== null ? currentPolicy : globalPolicy;
    const policyDto = (policy: typeof currentPolicy) => policy ? { ...policy, createdAt: policy.createdAt.toISOString() } : null;
    const filter = (column: Prisma.Sql) => sellerId ? Prisma.sql`WHERE ${column}=${sellerId}` : Prisma.empty;
    const andFilter = (column: Prisma.Sql) => sellerId ? Prisma.sql`AND ${column}=${sellerId}` : Prisma.empty;
    const [wallet] = await tx.$queryRaw<{ balanceCents: string; payableCents: string; receivableCents: string }[]>(Prisma.sql`
      SELECT COALESCE(sum("balanceCents"),0)::text AS "balanceCents",COALESCE(sum(GREATEST("balanceCents",0)),0)::text AS "payableCents",COALESCE(sum(GREATEST(-("balanceCents"::numeric),0)),0)::text AS "receivableCents"
      FROM "SellerWallet" ${filter(Prisma.sql`"sellerId"`)}`);
    const [payouts] = await tx.$queryRaw<{ reservedCents: string; paidCents: string }[]>(Prisma.sql`
      SELECT COALESCE(sum("amountCents") FILTER(WHERE status='RESERVED'),0)::text AS "reservedCents",COALESCE(sum("amountCents") FILTER(WHERE status='PAID'),0)::text AS "paidCents" FROM "SellerPayout" ${filter(Prisma.sql`"sellerId"`)}`);
    const [earnings] = await tx.$queryRaw<{ entitlementCents: string; potentialCents: string; heldShipments: string; unconfiguredShipments: string }[]>(Prisma.sql`
      SELECT COALESCE(sum(a."targetCents"),0)::text AS "entitlementCents",COALESCE(sum((a.projection->>'potentialCents')::numeric),0)::text AS "potentialCents",
      count(*) FILTER(WHERE jsonb_array_length(a.projection->'holds')>0)::text AS "heldShipments",count(*) FILTER(WHERE s."policyId" IS NULL)::text AS "unconfiguredShipments"
      FROM "SellerAccrual" a JOIN "OrderFulfillment" f ON f.id=a."fulfillmentId" JOIN "Order" o ON o.id=a."orderId" JOIN "SellerSettlementSnapshot" s ON s."fulfillmentId"=f.id
      WHERE true ${andFilter(Prisma.sql`a."sellerId"`)}`);
    const attempt = query.requestId ? await tx.sellerSettlementRequest.findFirst({ where: { id: query.requestId, actorId: actor.id }, select: { result: true } }) : null;
    const common = { ownerId: actor.id, ownerRole: current.role, seller, scopeKey, currentPolicy: policyDto(currentPolicy), globalPolicy: policyDto(globalPolicy), effectivePolicy: policyDto(effectivePolicy), summary: { ...wallet, ...payouts, ...earnings }, attempt: attempt?.result ?? null };
    const pagination = (count: number | string) => {
      const total = Number(count); if (!Number.isSafeInteger(total) || total < 0) throw new SettlementError("Settlement count exceeds the supported range.");
      const totalPages = Math.max(1, Math.ceil(total / 20)); if (query.page > totalPages) throw new SettlementError("This settlement page does not exist.", "SETTLEMENT_PAGE", 404);
      return { page: query.page, total, totalPages };
    };
    if (query.mode === "policies") {
      const where = sellerId ? { scopeKey: { in: ["GLOBAL", scopeKey] } } : { scopeKey: "GLOBAL" };
      const page = pagination(await tx.sellerSettlementPolicy.count({ where }));
      const rows = await tx.sellerSettlementPolicy.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 20, skip: (query.page - 1) * 20 });
      return { ...common, ...page, mode: "policies" as const, rows: rows.map((row) => policyDto(row)!) };
    }
    if (query.mode === "ledger") {
      const where = sellerId ? { sellerId } : {}, page = pagination(await tx.sellerLedgerEntry.count({ where }));
      const rows = await tx.sellerLedgerEntry.findMany({ where, orderBy: { sequence: "desc" }, take: 20, skip: (query.page - 1) * 20 });
      return { ...common, ...page, mode: "ledger" as const, rows: rows.map((row) => ({ ...row, sequence: row.sequence.toString(), deltaCents: row.deltaCents.toString(), createdAt: row.createdAt.toISOString() })) };
    }
    if (query.mode === "payouts") {
      const where = sellerId ? { sellerId } : {}, page = pagination(await tx.sellerPayout.count({ where }));
      const rows = await tx.sellerPayout.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 20, skip: (query.page - 1) * 20 });
      return { ...common, ...page, mode: "payouts" as const, rows: rows.map(payoutDto) };
    }
    if (query.mode === "shipments") {
      const [count] = await tx.$queryRaw<{ total: string }[]>(Prisma.sql`SELECT count(*)::text AS total FROM "SellerAccrual" a JOIN "OrderFulfillment" f ON f.id=a."fulfillmentId" JOIN "Order" o ON o.id=a."orderId" WHERE true ${andFilter(Prisma.sql`a."sellerId"`)}`);
      const page = pagination(count.total);
      const rows = await tx.$queryRaw<{ fulfillmentId: string; orderId: string; sellerId: string; projection: Prisma.JsonValue; version: number; snapshotVersion: number; policyId: string | null; capturedCommissionBps: number | null; capturedShippingRecipient: string | null; origin: string; capturedAt: Date; adoptedAt: Date | null; status: string; codCollected: boolean; paymentMethod: string; paymentStatus: string; effectivePolicyId: string | null; effectiveCommissionBps: number | null; effectiveShippingRecipient: string | null; unallocatedDisputeLossCents: string }[]>(Prisma.sql`
        SELECT a."fulfillmentId",a."orderId",a."sellerId",a.projection,a.version,s.version AS "snapshotVersion",s."policyId",captured."commissionBps" AS "capturedCommissionBps",captured."shippingRecipient" AS "capturedShippingRecipient",s.origin,s."capturedAt",s."adoptedAt",f.status,f."codCollected",o."paymentMethod",o."paymentStatus",
         active.id AS "effectivePolicyId",active."commissionBps" AS "effectiveCommissionBps",active."shippingRecipient" AS "effectiveShippingRecipient",seller_settlement_projection(o.id)->>'unallocatedDisputeLossCents' AS "unallocatedDisputeLossCents"
        FROM "SellerAccrual" a JOIN "OrderFulfillment" f ON f.id=a."fulfillmentId" JOIN "Order" o ON o.id=a."orderId" JOIN "SellerSettlementSnapshot" s ON s."fulfillmentId"=f.id
        LEFT JOIN "SellerSettlementPolicy" captured ON captured.id=s."policyId" LEFT JOIN "SellerSettlementPolicy" active ON active.id=effective_seller_settlement_policy(a."sellerId") WHERE true ${andFilter(Prisma.sql`a."sellerId"`)}
        ORDER BY a."createdAt" DESC,a."fulfillmentId" COLLATE "C" LIMIT 20 OFFSET ${(query.page - 1) * 20}`);
      return { ...common, ...page, mode: "shipments" as const, rows: rows.map((row) => ({ ...row, capturedAt: row.capturedAt.toISOString(), adoptedAt: row.adoptedAt?.toISOString() ?? null })) };
    }
    const [count] = await tx.$queryRaw<{ total: string }[]>(Prisma.sql`SELECT count(*)::text AS total FROM "User" WHERE role IN ('MEMBER','ADMIN') ${andFilter(Prisma.sql`id`)}`);
    const page = pagination(count.total);
    const rows = await tx.$queryRaw<{ id: string; name: string | null; email: string; sellerStatus: string; isVerified: boolean; balanceCents: string }[]>(Prisma.sql`
      SELECT u.id,u.name,u.email,u."sellerStatus",u."isVerified",COALESCE(w."balanceCents",0)::text AS "balanceCents" FROM "User" u LEFT JOIN "SellerWallet" w ON w."sellerId"=u.id WHERE u.role IN ('MEMBER','ADMIN') ${andFilter(Prisma.sql`u.id`)} ORDER BY u."createdAt" DESC,u.id COLLATE "C" LIMIT 20 OFFSET ${(query.page - 1) * 20}`);
    const monthStart = Prisma.sql`((date_trunc('month',timezone('Asia/Dhaka',CURRENT_TIMESTAMP))-interval '11 months') AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC'`;
    const monthly = await tx.$queryRaw<{ month: string; entitlementChangeCents: string; reservationChangeCents: string; paidCents: string }[]>(Prisma.sql`
      WITH months AS (SELECT to_char(month,'YYYY-MM') AS month FROM generate_series(date_trunc('month',timezone('Asia/Dhaka',CURRENT_TIMESTAMP))-interval '11 months',date_trunc('month',timezone('Asia/Dhaka',CURRENT_TIMESTAMP)),interval '1 month') month),
      entries AS (SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka','YYYY-MM') AS month,sum("deltaCents") FILTER(WHERE kind='ENTITLEMENT') AS credited,-sum("deltaCents") FILTER(WHERE kind IN ('PAYOUT_RESERVE','PAYOUT_RELEASE')) AS reserved FROM "SellerLedgerEntry" WHERE "createdAt">=${monthStart} ${andFilter(Prisma.sql`"sellerId"`)} GROUP BY 1),
      payments AS (SELECT to_char("resolvedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka','YYYY-MM') AS month,sum("amountCents") AS paid FROM "SellerPayout" WHERE status='PAID' AND "resolvedAt">=${monthStart} ${andFilter(Prisma.sql`"sellerId"`)} GROUP BY 1)
      SELECT m.month,COALESCE(e.credited,0)::text AS "entitlementChangeCents",COALESCE(e.reserved,0)::text AS "reservationChangeCents",COALESCE(p.paid,0)::text AS "paidCents" FROM months m LEFT JOIN entries e ON e.month=m.month LEFT JOIN payments p ON p.month=m.month ORDER BY m.month DESC`);
    return { ...common, ...page, mode: "overview" as const, rows, monthly };
  }, { isolationLevel: "RepeatableRead", timeout: 15_000, maxWait: 5000 });
}
export type SellerSettlementView = Awaited<ReturnType<typeof readSellerSettlement>>;
