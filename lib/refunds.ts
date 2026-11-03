import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { purchasedProduct } from "@/lib/purchase-product-label";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { ACTIVE_REFUND_STATES, RefundError, allocateDiscount, cents, integerCents, refundPlan } from "@/lib/refund-policy";
import { refundActionSchema, refundQuoteSchema, refundRequestSchema, type RefundAction } from "@/lib/validations/refund";
import { reconcileProductReviews } from "@/lib/reviews";

export const financeOrderInclude = { items: { take: 101, orderBy: { id: "asc" }, include: { fulfillment: true, product: { select: { name: true } } } } } satisfies Prisma.OrderInclude;
export type FinanceOrder = Prisma.OrderGetPayload<{ include: typeof financeOrderInclude }>;
export const refundInclude = { lines: { orderBy: { orderItemId: "asc" } } } satisfies Prisma.RefundInclude;
export type RefundRecord = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;
export async function financeTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout='3000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`; return work(tx); }, { timeout: 15_000, maxWait: 5000 });
}
export async function financeAudit(tx: Prisma.TransactionClient, actor?: AuthenticatedUser) {
  await tx.$queryRaw`SELECT set_config('amar.finance_actor_id',${actor?.id ?? ""},true),set_config('amar.finance_actor_role',${actor?.role ?? "SYSTEM"},true),set_config('amar.fulfillment_actor_id',${actor?.id ?? ""},true),set_config('amar.fulfillment_actor_role',${actor?.role ?? "SYSTEM"},true)`;
}
export async function lockFinanceActor(tx: Prisma.TransactionClient, actor: AuthenticatedUser, admin = true) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const saved = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, sessionVersion: true, isVerified: true } });
  if (!saved?.isVerified || saved.role !== actor.role || saved.sessionVersion !== actor.sessionVersion) throw new RefundError("Your account changed. Reload your session.", "REFUND_ACCOUNT_CHANGED");
  if (admin && saved.role !== "ADMIN") throw new RefundError("Administrator access is required.", "FORBIDDEN", 403);
  await financeAudit(tx, actor);
}
export async function lockFinanceOrder(tx: Prisma.TransactionClient, orderId: string, actor?: AuthenticatedUser, version?: number, admin = true) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  if (actor) await lockFinanceActor(tx, actor, admin); else await financeAudit(tx);
  const order = await tx.order.findUnique({ where: { id: orderId }, include: financeOrderInclude });
  if (!order || !order.items.length || (!admin && actor?.role !== "ADMIN" && order.userId !== actor?.id)) throw new RefundError("Order not found.", "REFUND_NOT_FOUND", 404);
  if (order.items.length > 100) throw new RefundError("This historical order exceeds the supported item limit and requires operator reconciliation.", "REFUND_REVIEW");
  if (version !== undefined && order.refundVersion !== version) throw new RefundError("This order's financial state changed. Reload before retrying.", "REFUND_CHANGED");
  return order;
}
export async function lockFinanceProducts(tx: Prisma.TransactionClient, order: FinanceOrder) {
  for (const productId of [...new Set(order.items.map((x) => x.productId))].sort()) await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
}
export async function financialEvent(tx: Prisma.TransactionClient, orderId: string, kind: string, evidence: string, actor?: AuthenticatedUser, amountCents?: number) {
  await tx.financialEvent.create({ data: { orderId, kind, evidence, actorId: actor?.id, actorRole: actor?.role ?? "SYSTEM", ...(amountCents !== undefined ? { amountCents: BigInt(amountCents) } : {}), createdAt: new Date() } });
}
function refundDto(row: RefundRecord, admin: boolean) {
  return { id: row.id, version: row.version, kind: row.kind, status: row.status, amountCents: integerCents(row.amountCents), shippingCents: integerCents(row.shippingCents), paymentMethod: row.paymentMethod, createdAt: row.createdAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({ itemId: line.orderItemId, quantity: line.quantity, amountCents: integerCents(line.amountCents), beforeDispatch: line.beforeDispatch })),
    ...(admin ? { requestId: row.requestId, reason: row.reason, providerRefundId: row.providerRefundId, providerPaymentIntentId: row.providerPaymentIntentId, providerStatus: row.providerStatus, submittedAt: row.submittedAt?.toISOString() ?? null, canRecoverMissing: row.status === "REVIEW" && !row.providerRefundId && row.submittedAt !== null && Date.now() - row.submittedAt.getTime() >= 24 * 60 * 60_000, errorCode: row.errorCode, manualMethod: row.manualMethod, manualReference: row.manualReference, allocationConfirmed: row.allocationConfirmed } : {}),
  };
}
export async function readRefundOrder(actor: AuthenticatedUser, orderId: string, page = 1, cursor?: string, requestId?: string) {
  return financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, orderId, actor, undefined, false), admin = actor.role === "ADMIN";
    const total = await tx.refund.count({ where: { orderId } }), totalPages = Math.max(1, Math.ceil(total / 20));
    if (page > totalPages) throw new RefundError("This refund page does not exist.", "REFUND_PAGE", 404);
    const rows = await tx.refund.findMany({ where: { orderId }, take: 20, skip: (page - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: refundInclude });
    if (cursor && !await tx.financialEvent.findFirst({ where: { id: cursor, orderId }, select: { id: true } })) throw new RefundError("History position not found.", "REFUND_HISTORY", 404);
    const history = await tx.financialEvent.findMany({ where: { orderId }, take: 51, orderBy: { sequence: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const attemptRefund = requestId && admin ? await tx.refund.findFirst({ where: { orderId, requestId }, include: refundInclude }) : null;
    const attemptReturn = requestId && admin ? await tx.orderReturn.findFirst({ where: { requestId, item: { orderId } }, select: { orderItemId: true, quantity: true } }) : null;
    const disputes = await tx.paymentDispute.findMany({ where: { orderId }, orderBy: { updatedAt: "desc" }, take: 20 });
    return { ownerId: actor.id, page, total, totalPages, attempt: admin ? { refund: attemptRefund ? refundDto(attemptRefund, true) : null, returned: attemptReturn } : null, disputes: disputes.map((row) => ({ ...(admin ? { id: row.id } : {}), status: row.status, amountCents: integerCents(row.amountCents), fundsLostCents: integerCents(row.fundsLostCents) })), order: { id: order.id, status: order.status, version: order.refundVersion, totalCents: cents(order.total), refundedCents: integerCents(order.refundedCents), shippingRefundedCents: integerCents(order.shippingRefundedCents), refundState: order.refundState, disputeStatus: order.disputeStatus, disputeAmountCents: integerCents(order.disputeAmountCents), paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
      pricing: order.subtotalCents !== null ? { subtotalCents: integerCents(order.subtotalCents), discountCents: integerCents(order.discountCents!), shippingCents: integerCents(order.shippingCents!) } : null,
      ...(admin ? { reviewReason: order.financialReviewReason, pricingEvidence: order.pricingEvidence } : {}),
    }, items: order.items.map((item) => ({ id: item.id, name: purchasedProduct(item).name, quantity: item.quantity, refundedQuantity: item.refundedQuantity, returnedQuantity: item.returnedQuantity, voidedQuantity: item.voidedQuantity, version: item.financialVersion, grossCents: cents(item.price.mul(item.quantity)), netCents: item.netCents === null ? null : integerCents(item.netCents), refundedCents: integerCents(item.refundedCents), status: item.fulfillment!.status, codCollected: item.fulfillment!.codCollected })), refunds: rows.map((row) => refundDto(row, admin)),
      history: history.slice(0, 50).map((event) => ({ id: event.id, kind: event.kind, status: event.status, amountCents: event.amountCents === null ? null : integerCents(event.amountCents), createdAt: event.createdAt.toISOString(), ...(admin ? { actorId: event.actorId, actorRole: event.actorRole, evidence: event.evidence, refundId: event.refundId } : {}) })), nextCursor: history.length > 50 ? history[49].id : null };
  });
}
export type RefundOrderView = Awaited<ReturnType<typeof readRefundOrder>>;

export async function reconcileRefundLedger(tx: Prisma.TransactionClient, order: FinanceOrder) {
  const [money, shipping, active, unallocated, quantities, reviews] = await Promise.all([
    tx.refund.aggregate({ where: { orderId: order.id, status: "SUCCEEDED" }, _sum: { amountCents: true } }),
    tx.refund.aggregate({ where: { orderId: order.id, status: "SUCCEEDED", allocationConfirmed: true }, _sum: { shippingCents: true } }),
    tx.refund.count({ where: { orderId: order.id, status: { in: [...ACTIVE_REFUND_STATES] } } }),
    tx.refund.count({ where: { orderId: order.id, allocationConfirmed: false, status: { notIn: ["FAILED", "CANCELLED"] } } }),
    tx.refundLine.groupBy({ by: ["orderItemId"], where: { refund: { orderId: order.id, status: "SUCCEEDED", allocationConfirmed: true } }, _sum: { quantity: true, amountCents: true } }),
    tx.refund.count({ where: { orderId: order.id, status: "REVIEW" } }),
  ]);
  const refunded = money._sum.amountCents ?? BigInt(0);
  if (refunded > BigInt(cents(order.total))) throw new RefundError("Provider reimbursements exceed the recorded capture. Operator reconciliation is required.", "REFUND_OVERAGE");
  for (const item of order.items) {
    const sum = quantities.find((row) => row.orderItemId === item.id), quantity = sum?._sum.quantity ?? 0, amount = sum?._sum.amountCents ?? BigInt(0);
    if (quantity !== item.refundedQuantity || amount !== item.refundedCents) await tx.orderItem.update({ where: { id: item.id }, data: { refundedQuantity: quantity, refundedCents: amount, financialVersion: { increment: 1 } } });
  }
  const repaymentDue = order.items.some((item) => item.voidedQuantity > (quantities.find((row) => row.orderItemId === item.id)?._sum.quantity ?? 0));
  let reviewReason = ["EXTERNAL_REFUND_ALLOCATION_REQUIRED", "VOIDED_REFUND_REPAYMENT_REQUIRED"].includes(order.financialReviewReason ?? "") ? null : order.financialReviewReason;
  if (unallocated) reviewReason = "EXTERNAL_REFUND_ALLOCATION_REQUIRED";
  else if (!reviewReason && repaymentDue) reviewReason = "VOIDED_REFUND_REPAYMENT_REQUIRED";
  await tx.order.update({ where: { id: order.id }, data: { refundedCents: refunded, shippingRefundedCents: shipping._sum.shippingCents ?? BigInt(0), refundVersion: { increment: 1 }, fulfillmentVersion: { increment: 1 }, financialReviewReason: reviewReason,
    refundState: reviewReason || reviews ? "REVIEW" : active ? "PENDING" : refunded === BigInt(cents(order.total)) && refunded > BigInt(0) ? "REFUNDED" : refunded > BigInt(0) ? "PARTIAL" : "NONE",
    ...(refunded === BigInt(cents(order.total)) && order.reservationReviewReason === "LATE_PAYMENT_REQUIRES_REFUND" ? { reservationReviewReason: null } : {}),
  } });
  for (const productId of [...new Set(order.items.map((item) => item.productId))].sort()) await reconcileProductReviews(tx, productId);
}

/** Apply confirmed financial truth once. Post-dispatch refunds never restock. */
export async function applyRefundInventory(tx: Prisma.TransactionClient, order: FinanceOrder, refund: RefundRecord) {
  if (refund.appliedAt || !refund.allocationConfirmed || refund.status !== "SUCCEEDED") return;
  await tx.$queryRaw`SELECT set_config('amar.fulfillment_adjustment','true',true)`;
  const changedGroups = new Set<string>();
  for (const line of refund.lines) {
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: line.orderItemId } });
    if (line.beforeDispatch && line.quantity) {
      const voided = Math.max(item.voidedQuantity, line.offset + line.quantity), extra = voided - item.voidedQuantity;
      if (extra) {
        await tx.orderItem.update({ where: { id: item.id }, data: { voidedQuantity: voided, financialVersion: { increment: 1 } } });
        if (order.status !== "CANCELLED" && order.items.find((x) => x.id === item.id)!.fulfillment!.status !== "CANCELLED") await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: extra } } });
      }
    }
    if (item.fulfillmentId) changedGroups.add(item.fulfillmentId);
  }
  for (const id of [...changedGroups].sort()) {
    const items = await tx.orderItem.findMany({ where: { fulfillmentId: id }, select: { quantity: true, voidedQuantity: true } });
    const group = await tx.orderFulfillment.findUniqueOrThrow({ where: { id } });
    await tx.orderFulfillment.update({ where: { id }, data: { version: { increment: 1 }, ...(items.every((x) => x.quantity === x.voidedQuantity) && ["PENDING", "PROCESSING"].includes(group.status) ? { status: "CANCELLED" } : {}) } });
  }
  const [aggregate] = await tx.$queryRaw<{ status: string }[]>`SELECT aggregate_order_fulfillments(${order.id}) AS status`;
  await tx.order.update({ where: { id: order.id }, data: { status: aggregate.status } });
  await tx.refund.update({ where: { id: refund.id }, data: { appliedAt: new Date(), version: { increment: 1 } } });
}

export async function requestRefund(actor: AuthenticatedUser, input: unknown) {
  const parsed = refundRequestSchema.parse(input), canonical = { ...parsed, selection: parsed.selection === "FULL" ? "FULL" : [...parsed.selection].sort((a, b) => a.itemId.localeCompare(b.itemId)) };
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, parsed.orderId, actor);
    const existing = await tx.refund.findUnique({ where: { requestId: parsed.requestId }, include: refundInclude });
    if (existing) {
      if (existing.orderId !== order.id || existing.createdById !== actor.id || existing.requestHash !== hash) throw new RefundError("This refund attempt belongs to different details.", "REFUND_REQUEST_CONFLICT");
      return { ownerId: actor.id, orderId: order.id, refund: refundDto(existing, true) };
    }
    if (order.refundVersion !== parsed.version) throw new RefundError("Financial state changed. Reload before requesting a refund.", "REFUND_CHANGED");
    if (order.subtotalCents === null) throw new RefundError("Reconcile this historical order's shipping and discount breakdown first.", "REFUND_PRICING_REQUIRED");
    if ((order.financialReviewReason && order.financialReviewReason !== "VOIDED_REFUND_REPAYMENT_REQUIRED") || ["ACTIVE", "LOST"].includes(order.disputeStatus)) throw new RefundError("Resolve the recorded financial review or payment dispute first.", "REFUND_REVIEW");
    if (await tx.refund.count({ where: { orderId: order.id, status: { in: [...ACTIVE_REFUND_STATES] } } })) throw new RefundError("A refund is already active. Reconcile it before creating another.", "REFUND_ACTIVE");
    if (!["STRIPE", "COD"].includes(order.paymentMethod)) throw new RefundError("Unsupported payment method.", "REFUND_PAYMENT");
    const plan = refundPlan(order.items.map((item) => ({ id: item.id, quantity: item.quantity, refundedQuantity: item.refundedQuantity, netCents: integerCents(item.netCents!), refundedCents: integerCents(item.refundedCents), dispatched: ["SHIPPED", "DELIVERED"].includes(item.fulfillment!.status) || item.fulfillment!.shippedAt !== null, paid: order.paymentMethod === "STRIPE" ? order.paymentStatus === "PAID" : item.fulfillment!.codCollected })), parsed.selection, integerCents(order.shippingCents! - order.shippingRefundedCents));
    if (plan.amountCents > cents(order.total) - integerCents(order.refundedCents)) throw new RefundError("Refund exceeds the remaining captured amount.", "REFUND_MONEY");
    const refund = await tx.refund.create({ data: { orderId: order.id, requestId: parsed.requestId, requestHash: hash, createdById: actor.id, reason: parsed.reason, kind: parsed.selection === "FULL" ? "FULL" : "ITEMS", amountCents: BigInt(plan.amountCents), shippingCents: BigInt(plan.shippingCents), paymentMethod: order.paymentMethod, providerPaymentIntentId: order.paymentIntentId, nextCheckAt: order.paymentMethod === "STRIPE" ? new Date() : null,
      lines: { create: plan.lines.map((line) => ({ orderItemId: line.itemId, quantity: line.quantity, offset: line.offset, amountCents: BigInt(line.amountCents), beforeDispatch: line.beforeDispatch })) } }, include: refundInclude });
    await lockFinanceProducts(tx, order); await reconcileRefundLedger(tx, order);
    return { ownerId: actor.id, orderId: order.id, refund: refundDto(refund, true) };
  });
}

export async function quoteRefund(actor: AuthenticatedUser, input: unknown) {
  const data = refundQuoteSchema.parse(input);
  return financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, data.orderId, actor, data.version);
    if (order.subtotalCents === null) throw new RefundError("Reconcile this order's purchase pricing first.", "REFUND_PRICING_REQUIRED");
    if ((order.financialReviewReason && order.financialReviewReason !== "VOIDED_REFUND_REPAYMENT_REQUIRED") || ["ACTIVE", "LOST"].includes(order.disputeStatus) || await tx.refund.count({ where: { orderId: order.id, status: { in: [...ACTIVE_REFUND_STATES] } } })) throw new RefundError("Resolve the active financial operation or review before quoting another refund.", "REFUND_ACTIVE");
    const quote = refundPlan(order.items.map((item) => ({ id: item.id, quantity: item.quantity, refundedQuantity: item.refundedQuantity, netCents: integerCents(item.netCents!), refundedCents: integerCents(item.refundedCents), dispatched: ["SHIPPED", "DELIVERED"].includes(item.fulfillment!.status) || item.fulfillment!.shippedAt !== null, paid: order.paymentMethod === "STRIPE" ? order.paymentStatus === "PAID" : item.fulfillment!.codCollected })), data.selection, integerCents(order.shippingCents! - order.shippingRefundedCents));
    return { ownerId: actor.id, orderId: order.id, version: order.refundVersion, quote };
  });
}

export async function mutateRefundLocally(actor: AuthenticatedUser, input: unknown) {
  const parsed = refundActionSchema.parse(input);
  if (parsed.action === "quote") return quoteRefund(actor, parsed.request);
  if (parsed.action === "request") return requestRefund(actor, parsed.request);
  if (["process", "recover-missing"].includes(parsed.action)) throw new RefundError("Use provider reconciliation for this operation.", "REFUND_PROVIDER_ACTION");
  return financeTransaction(async (tx) => {
    const candidate = "refundId" in parsed ? await tx.refund.findUnique({ where: { id: parsed.refundId }, select: { orderId: true } }) : null;
    const orderId = "orderId" in parsed ? parsed.orderId : candidate?.orderId;
    if (!orderId) throw new RefundError("Refund not found.", "REFUND_NOT_FOUND", 404);
    const order = await lockFinanceOrder(tx, orderId, actor, "orderId" in parsed && parsed.action !== "return" ? parsed.version : undefined);
    await lockFinanceProducts(tx, order);
    if (parsed.action === "pricing") {
      if (order.subtotalCents !== null) throw new RefundError("This purchase already has an immutable pricing snapshot.", "REFUND_PRICING_EXISTS");
      const gross = order.items.map((item) => ({ id: item.id, grossCents: cents(item.price.mul(item.quantity)) })), subtotal = gross.reduce((sum, item) => sum + item.grossCents, 0), discount = subtotal + parsed.shippingCents - cents(order.total);
      const allocations = allocateDiscount(gross, discount);
      for (const item of allocations) await tx.orderItem.update({ where: { id: item.id }, data: { netCents: BigInt(item.netCents), financialVersion: { increment: 1 } } });
      await tx.order.update({ where: { id: order.id }, data: { subtotalCents: BigInt(subtotal), discountCents: BigInt(discount), shippingCents: BigInt(parsed.shippingCents), pricingEvidence: parsed.evidence, pricingReconciledAt: new Date(), refundVersion: { increment: 1 } } });
      await financialEvent(tx, order.id, "PRICING_RECONCILED", parsed.evidence, actor);
    } else if (parsed.action === "resolve-review") {
      if (order.financialReviewReason !== "PROVIDER_REFUND_REVERSED" || ["ACTIVE", "LOST"].includes(order.disputeStatus) || await tx.refund.count({ where: { orderId: order.id, status: { in: [...ACTIVE_REFUND_STATES] } } })) throw new RefundError("This review requires provider reconciliation or external allocation first.", "REFUND_REVIEW");
      await financialEvent(tx, order.id, "PROVIDER_REVERSAL_ACKNOWLEDGED", parsed.evidence, actor);
      order.financialReviewReason = null; await reconcileRefundLedger(tx, order);
    } else if (parsed.action === "return") {
      await acceptPhysicalReturn(tx, actor, order, parsed);
    } else {
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: parsed.refundId }, include: refundInclude });
      if (refund.version !== parsed.version) throw new RefundError("This refund changed. Reload its current state.", "REFUND_CHANGED");
      if (parsed.action === "confirm-cod") {
        if (refund.paymentMethod !== "COD" || refund.status !== "QUEUED" || !refund.allocationConfirmed || ["ACTIVE", "LOST"].includes(order.disputeStatus) || order.financialReviewReason) throw new RefundError("Only a current COD request with cleared financial state can be confirmed.", "REFUND_STATE");
        const saved = await tx.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", manualMethod: parsed.method, manualReference: parsed.reference, confirmedById: actor.id, confirmedAt: new Date(), nextCheckAt: null, version: { increment: 1 } }, include: refundInclude });
        await applyRefundInventory(tx, order, saved); await reconcileRefundLedger(tx, order);
      } else if (parsed.action === "cancel-request") {
        if (!["QUEUED", "REVIEW"].includes(refund.status) || refund.submittedAt || refund.providerRefundId || refund.kind === "EXTERNAL") throw new RefundError("A submitted or provider-confirmed refund cannot be cancelled locally.", "REFUND_STATE");
        await tx.refund.update({ where: { id: refund.id }, data: { status: "CANCELLED", errorCode: "ADMIN_CANCELLED_BEFORE_SUBMISSION", nextCheckAt: null, version: { increment: 1 } } });
        await financialEvent(tx, order.id, "REFUND_CANCELLED", parsed.reason, actor); await reconcileRefundLedger(tx, order);
      } else if (parsed.action === "allocate-external") {
        await allocateExternal(tx, actor, order, refund, parsed);
      }
    }
    return { ownerId: actor.id, orderId: order.id };
  });
}

async function acceptPhysicalReturn(tx: Prisma.TransactionClient, actor: AuthenticatedUser, order: FinanceOrder, data: Extract<RefundAction, { action: "return" }>) {
  const previous = await tx.orderReturn.findUnique({ where: { requestId: data.requestId } });
  if (previous) {
    if (previous.orderItemId !== data.itemId || previous.quantity !== data.quantity || previous.acceptedById !== actor.id || previous.evidence !== data.evidence) throw new RefundError("The return attempt belongs to different details.", "REFUND_REQUEST_CONFLICT");
    return;
  }
  const item = order.items.find((item) => item.id === data.itemId);
  if (!item || item.financialVersion !== data.version) throw new RefundError("The purchased item changed. Reload it.", "REFUND_CHANGED");
  if (!["SHIPPED", "DELIVERED"].includes(item.fulfillment!.status) || data.quantity > item.quantity - item.voidedQuantity - item.returnedQuantity) throw new RefundError("Only actually dispatched, not already returned quantities can be accepted.", "REFUND_RETURN");
  await tx.orderReturn.create({ data: { requestId: data.requestId, orderItemId: item.id, quantity: data.quantity, evidence: data.evidence, acceptedById: actor.id, createdAt: new Date() } });
  await tx.orderItem.update({ where: { id: item.id }, data: { returnedQuantity: { increment: data.quantity }, financialVersion: { increment: 1 } } });
  await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: data.quantity } } });
  await tx.order.update({ where: { id: order.id }, data: { refundVersion: { increment: 1 } } });
  await financialEvent(tx, order.id, "RETURN_INSPECTED_AND_RESTOCKED", data.evidence, actor);
}
async function allocateExternal(tx: Prisma.TransactionClient, actor: AuthenticatedUser, order: FinanceOrder, refund: RefundRecord, data: Extract<RefundAction, { action: "allocate-external" }>) {
  if (refund.kind !== "EXTERNAL" || refund.allocationConfirmed || refund.status !== "SUCCEEDED" || order.subtotalCents === null) throw new RefundError("Only a verified external refund with reconciled purchase pricing can be allocated.", "REFUND_STATE");
  if (data.shippingCents > integerCents(order.shippingCents! - order.shippingRefundedCents) || data.lines.reduce((sum, line) => sum + line.amountCents, data.shippingCents) !== integerCents(refund.amountCents)) throw new RefundError("The allocation must match the actual provider refund and remaining shipping exactly.", "REFUND_MONEY");
  for (const line of data.lines) {
    const item = order.items.find((x) => x.id === line.itemId);
    if (!item || line.quantity > item.quantity - item.refundedQuantity || line.amountCents > integerCents(item.netCents! - item.refundedCents)) throw new RefundError("An external allocation exceeds the remaining purchased item.", "REFUND_ITEMS");
    // Provider-dashboard history can precede webhook delivery. Use current
    // dispatch facts for inventory; never invent a prior return or delivery.
    await tx.refundLine.create({ data: { refundId: refund.id, orderItemId: item.id, quantity: line.quantity, offset: item.refundedQuantity, amountCents: BigInt(line.amountCents), beforeDispatch: !["SHIPPED", "DELIVERED"].includes(item.fulfillment!.status) } });
  }
  const saved = await tx.refund.update({ where: { id: refund.id }, data: { allocationConfirmed: true, shippingCents: BigInt(data.shippingCents), version: { increment: 1 } }, include: refundInclude });
  await financialEvent(tx, order.id, "EXTERNAL_REFUND_ALLOCATED", data.evidence, actor); await applyRefundInventory(tx, order, saved); await reconcileRefundLedger(tx, order);
}
