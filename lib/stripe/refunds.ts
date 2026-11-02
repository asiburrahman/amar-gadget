import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe/stripe";
import type { AuthenticatedUser } from "@/lib/session";
import { ACTIVE_REFUND_STATES, RefundError, cents, integerCents } from "@/lib/refund-policy";
import { applyRefundInventory, financeTransaction, financialEvent, lockFinanceOrder, lockFinanceProducts, reconcileRefundLedger, refundInclude, type FinanceOrder } from "@/lib/refunds";
import { confirmStripePayment } from "@/lib/checkout-reservations";
import { reconcileProductReviews } from "@/lib/reviews";

const objectId = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id ?? null;
const status = (value: Stripe.Refund["status"] | undefined) => (({ succeeded: "SUCCEEDED", failed: "FAILED", canceled: "CANCELLED", pending: "PENDING", requires_action: "REQUIRES_ACTION" } as Record<string, string>)[value ?? ""] ?? "REVIEW");
const closed = (value: string) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(value);

async function paymentOrder(paymentIntentId: string, metadataOrderId?: string) {
  const rows = await prisma.order.findMany({ where: { paymentMethod: "STRIPE", OR: [{ paymentIntentId }, ...(metadataOrderId ? [{ id: metadataOrderId, paymentIntentId: null }] : [])] }, take: 2, select: { id: true, paymentIntentId: true, stripeCheckoutSessionId: true } });
  if (rows.length > 1) throw new RefundError("The provider payment cannot be matched to exactly one order.", "REFUND_PROVIDER_MATCH");
  return rows[0] ?? null;
}

/** Provider-originated refunds are real money, even before item attribution. */
async function importProviderRefund(orderId: string, object: Stripe.Refund) {
  const paymentId = objectId(object.payment_intent);
  if (!paymentId || object.currency !== "bdt" || !Number.isSafeInteger(object.amount) || object.amount < 0) throw new RefundError("Provider refund currency or amount mismatch.", "REFUND_PROVIDER_MATCH");
  return financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, orderId); await lockFinanceProducts(tx, order);
    if (order.paymentMethod !== "STRIPE" || (order.paymentIntentId && order.paymentIntentId !== paymentId)) throw new RefundError("Provider payment identity mismatch.", "REFUND_PROVIDER_MATCH");
    if (!order.paymentIntentId) await tx.order.update({ where: { id: order.id }, data: { paymentIntentId: paymentId, refundVersion: { increment: 1 } } });
    let row = await tx.refund.findUnique({ where: { providerRefundId: object.id }, include: refundInclude });
    if (!row && object.metadata?.amarRefundId) {
      const intended = await tx.refund.findUnique({ where: { id: object.metadata.amarRefundId }, include: refundInclude });
      if (intended?.orderId === orderId && intended.paymentMethod === "STRIPE" && integerCents(intended.amountCents) === object.amount) row = intended;
    }
    if (row && row.orderId !== order.id) throw new RefundError("Provider refund belongs to another order.", "REFUND_PROVIDER_MATCH");
    if (row) return row.id;
    row = await tx.refund.create({ data: { orderId: order.id, requestId: randomUUID(), requestHash: createHash("sha256").update(`external:${object.id}`).digest("hex"), createdById: "PROVIDER", reason: "Refund recorded by the payment provider outside this application's allocation workflow.", kind: "EXTERNAL", status: "REVIEW", amountCents: BigInt(object.amount), paymentMethod: "STRIPE", providerRefundId: object.id, providerPaymentIntentId: paymentId, providerCreatedAt: new Date(object.created * 1000), allocationConfirmed: false, errorCode: "PROVIDER_RECONCILIATION_REQUIRED", nextCheckAt: new Date() }, include: refundInclude });
    await reconcileRefundLedger(tx, order); return row.id;
  });
}
async function currentPayment(stripe: Stripe, order: FinanceOrder, savedIntentId: string | null) {
  let intentId = savedIntentId;
  if (!intentId) {
    if (!order.stripeCheckoutSessionId) throw new RefundError("The captured payment has no recoverable provider reference.", "REFUND_PROVIDER_REFERENCE");
    const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (session.metadata?.orderId !== order.id || session.payment_status !== "paid" || session.currency !== "bdt" || session.amount_total !== cents(order.total)) throw new RefundError("Captured checkout details do not match this order.", "REFUND_PROVIDER_MATCH");
    intentId = objectId(session.payment_intent);
  }
  if (!intentId) throw new RefundError("The payment intent reference is unavailable.", "REFUND_PROVIDER_REFERENCE");
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
  if (intent.status !== "succeeded" || intent.currency !== "bdt" || intent.amount_received !== cents(order.total) || intent.metadata.orderId !== order.id) throw new RefundError("Captured provider amount, currency or order does not match.", "REFUND_PROVIDER_MATCH");
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : intent.latest_charge ? await stripe.charges.retrieve(intent.latest_charge) : null;
  if (!charge || !charge.paid || charge.currency !== "bdt" || objectId(charge.payment_intent) !== intent.id) throw new RefundError("Captured charge details could not be confirmed.", "REFUND_PROVIDER_MATCH");
  if (charge.disputed) throw new RefundError("This payment is disputed. Resolve the dispute before issuing another refund.", "REFUND_PAYMENT_DISPUTED");
  return intent.id;
}
async function listRefunds(stripe: Stripe, intentId: string, deadline = Date.now() + 15_000) {
  const found: Stripe.Refund[] = []; let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    if (Date.now() > deadline - 4000) throw new Error("Provider history budget exhausted");
    const batch = await stripe.refunds.list({ payment_intent: intentId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }); found.push(...batch.data);
    if (!batch.has_more) return found;
    if (!batch.data.length) break;
    cursor = batch.data[batch.data.length - 1].id;
  }
  throw new RefundError("The provider refund history exceeds one reconciliation pass. Operator review is required.", "REFUND_PROVIDER_HISTORY");
}

export async function processCardRefund(refundId: string, actor?: AuthenticatedUser, version?: number, verifyCompleted = false) {
  const candidate = await prisma.refund.findUnique({ where: { id: refundId }, select: { orderId: true } });
  if (!candidate) throw new RefundError("Refund not found.", "REFUND_NOT_FOUND", 404);
  const claim = await financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, candidate.orderId, actor), row = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: refundInclude });
    if (version !== undefined && row.version !== version) throw new RefundError("This refund changed. Reload it.", "REFUND_CHANGED");
    if (row.paymentMethod !== "STRIPE") throw new RefundError("COD refunds require the administrator's external repayment confirmation.", "REFUND_PAYMENT");
    if (closed(row.status) && !verifyCompleted) return null;
    if (row.leaseUntil && row.leaseUntil > new Date()) return null;
    const token = randomUUID(), saved = await tx.refund.update({ where: { id: row.id }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 120_000), nextCheckAt: new Date(Date.now() + 120_000), ...(row.status === "QUEUED" ? { status: "SUBMITTING" } : {}), version: { increment: 1 } }, include: refundInclude });
    await tx.order.update({ where: { id: order.id }, data: { refundVersion: { increment: 1 } } });
    return { token, row: saved, order };
  });
  if (!claim) return { orderId: candidate.orderId, busyOrComplete: true };
  const deadline = Date.now() + 18_000;
  try {
    const stripe = getStripe({ timeout: 4000, maxNetworkRetries: 0 });
    let object: Stripe.Refund | null = null;
    if (claim.row.providerRefundId) object = await stripe.refunds.retrieve(claim.row.providerRefundId);
    else if (claim.row.amountCents === BigInt(0)) {
      await completeZeroRefund(claim.row.id, claim.token); return { orderId: candidate.orderId, busyOrComplete: false };
    } else {
      const intentId = await currentPayment(stripe, claim.order, claim.row.providerPaymentIntentId);
      const history = await listRefunds(stripe, intentId, deadline);
      object = history.find((refund) => refund.metadata?.amarRefundId === claim.row.id) ?? null;
      const local = await prisma.refund.findMany({ where: { orderId: candidate.orderId, providerRefundId: { in: history.map((refund) => refund.id) } }, select: { providerRefundId: true, providerStatus: true } });
      const other = history.filter((refund) => refund.id !== object?.id && !local.some((row) => row.providerRefundId === refund.id && row.providerStatus === refund.status));
      // Import a bounded number per pass. Do not create a new refund while any
      // provider operation has not been accounted for locally.
      for (const refund of other.slice(0, 20)) {
        if (Date.now() > deadline) throw new Error("Provider reconciliation budget exhausted");
        const localId = await importProviderRefund(candidate.orderId, refund);
        await reconcileProviderObject(localId, refund);
      }
      if (other.length > 20) throw new RefundError("Provider refund history needs additional reconciliation passes.", "REFUND_PROVIDER_HISTORY");
      if (!object) {
        if (claim.row.submittedAt && Date.now() - claim.row.submittedAt.getTime() >= 23 * 60 * 60_000) throw new RefundError("The provider idempotency window has elapsed. Confirm the missing attempt before creating a new refund intent.", "REFUND_IDEMPOTENCY_REVIEW");
        if (Date.now() > deadline - 4000) throw new Error("Provider submission budget exhausted");
        await financeTransaction(async (tx) => {
          const order = await lockFinanceOrder(tx, candidate.orderId, actor), current = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: refundInclude });
          if (current.leaseToken !== claim.token) throw new RefundError("Another reconciliation pass owns this refund.", "REFUND_LEASE");
          if ((order.financialReviewReason && order.financialReviewReason !== "VOIDED_REFUND_REPAYMENT_REQUIRED") || ["ACTIVE", "LOST"].includes(order.disputeStatus) || integerCents(order.refundedCents + current.amountCents) > cents(order.total)) throw new RefundError("The financial state changed before provider submission.", "REFUND_REVIEW");
          for (const line of current.lines) {
            const item = order.items.find((item) => item.id === line.orderItemId);
            if (!item || item.refundedQuantity !== line.offset || item.refundedCents + line.amountCents > item.netCents! || (line.beforeDispatch && ["SHIPPED", "DELIVERED"].includes(item.fulfillment!.status))) throw new RefundError("The approved item allocation changed before submission.", "REFUND_PLAN_CHANGED");
          }
          await tx.refund.update({ where: { id: refundId }, data: { providerPaymentIntentId: intentId, submittedAt: current.submittedAt ?? new Date(), version: { increment: 1 } } });
        });
        object = await stripe.refunds.create({ payment_intent: intentId, amount: integerCents(claim.row.amountCents), reason: "requested_by_customer", metadata: { amarRefundId: claim.row.id, orderId: candidate.orderId } }, { idempotencyKey: `amar-refund-${claim.row.id}` });
      }
    }
    await reconcileProviderObject(refundId, object, claim.token);
    return { orderId: candidate.orderId, busyOrComplete: false };
  } catch (error) {
    await financeTransaction(async (tx) => {
      const order = await lockFinanceOrder(tx, candidate.orderId), current = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (current.leaseToken !== claim.token || closed(current.status)) return;
      const definitive = error instanceof Stripe.errors.StripeInvalidRequestError && error.code !== "idempotency_key_in_use";
      const review = error instanceof RefundError;
      await tx.refund.update({ where: { id: refundId }, data: { status: definitive ? "FAILED" : review ? "REVIEW" : current.submittedAt ? "SUBMITTING" : "QUEUED", errorCode: review ? error.code : definitive ? "PROVIDER_REQUEST_REJECTED" : "PROVIDER_RETRY_REQUIRED", leaseToken: null, leaseUntil: null, nextCheckAt: definitive || review ? null : new Date(Date.now() + 60_000), version: { increment: 1 } } });
      await lockFinanceProducts(tx, order); await reconcileRefundLedger(tx, order);
    });
    if (error instanceof RefundError) throw error;
    throw new RefundError("Provider processing was not confirmed. Reload the saved refund; any uncertain attempt will be reconciled with the same provider intent.", "REFUND_PROVIDER_UNAVAILABLE", 503);
  }
}

async function completeZeroRefund(id: string, token: string) {
  const candidate = await prisma.refund.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
  await financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, candidate.orderId); await lockFinanceProducts(tx, order);
    const row = await tx.refund.findUniqueOrThrow({ where: { id }, include: refundInclude });
    if (row.leaseToken !== token || row.amountCents !== BigInt(0)) throw new RefundError("Refund reconciliation changed.", "REFUND_LEASE");
    const saved = await tx.refund.update({ where: { id }, data: { status: "SUCCEEDED", providerStatus: "NO_FUNDS_DUE", confirmedAt: new Date(), nextCheckAt: null, leaseToken: null, leaseUntil: null, errorCode: null, version: { increment: 1 } }, include: refundInclude });
    await applyRefundInventory(tx, order, saved); await reconcileRefundLedger(tx, order);
  });
}
/** Only pass objects obtained from the configured Stripe SDK or a verified
 * webhook. A lease fences local outbound work against a racing webhook. */
async function reconcileProviderObject(id: string, object: Stripe.Refund, token?: string) {
  const candidate = await prisma.refund.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
  return financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, candidate.orderId); await lockFinanceProducts(tx, order);
    const row = await tx.refund.findUniqueOrThrow({ where: { id }, include: refundInclude });
    if (token ? row.leaseToken !== token : row.leaseUntil && row.leaseUntil > new Date()) return false;
    if (object.currency !== "bdt" || object.amount !== integerCents(row.amountCents) || objectId(object.payment_intent) !== (row.providerPaymentIntentId ?? order.paymentIntentId) || (row.providerRefundId && row.providerRefundId !== object.id)) throw new RefundError("Provider refund identity, currency or amount mismatch.", "REFUND_PROVIDER_MATCH");
    const next = status(object.status);
    if (closed(row.status) && !closed(next)) return true;
    const reversed = row.status === "SUCCEEDED" && ["FAILED", "CANCELLED"].includes(next);
    const saved = await tx.refund.update({ where: { id }, data: { status: next, providerRefundId: object.id, providerStatus: object.status ?? "unknown", providerPaymentIntentId: objectId(object.payment_intent), providerCreatedAt: new Date(object.created * 1000), ...(next === "SUCCEEDED" && !row.confirmedAt ? { confirmedAt: new Date() } : {}), errorCode: object.failure_reason ?? (next === "REVIEW" ? "UNKNOWN_PROVIDER_REFUND_STATE" : null), leaseToken: null, leaseUntil: null, nextCheckAt: closed(next) ? null : new Date(Date.now() + 60_000), version: { increment: 1 } }, include: refundInclude });
    await applyRefundInventory(tx, order, saved);
    if (reversed) {
      await tx.order.update({ where: { id: order.id }, data: { financialReviewReason: "PROVIDER_REFUND_REVERSED" } }); order.financialReviewReason = "PROVIDER_REFUND_REVERSED";
      await financialEvent(tx, order.id, "PROVIDER_REFUND_REVERSED", "The provider no longer confirms a previously completed reimbursement. Inventory evidence is retained.");
    }
    await reconcileRefundLedger(tx, order);
    return true;
  });
}

export async function handleRefundWebhook(object: Stripe.Refund) {
  const paymentId = objectId(object.payment_intent);
  if (!paymentId) return null;
  const stripe = getStripe({ timeout: 4000, maxNetworkRetries: 0 }), matched = await incomingCapture(stripe, paymentId, object.metadata?.orderId);
  if (!matched) return null;
  const id = await importProviderRefund(matched.id, object);
  await confirmStripePayment(matched.id, paymentId, matched.amount, "bdt");
  const result = await processCardRefund(id, undefined, undefined, true); return { orderId: matched.id, deferred: result.busyOrComplete };
}
export async function handleChargeRefundWebhook(charge: Stripe.Charge) {
  const paymentId = objectId(charge.payment_intent);
  if (!paymentId) return;
  const stripe = getStripe({ timeout: 4000, maxNetworkRetries: 0 }), matched = await incomingCapture(stripe, paymentId, charge.metadata?.orderId);
  if (!matched) return null;
  const records = await listRefunds(stripe, paymentId);
  const known = await prisma.refund.findMany({ where: { orderId: matched.id, providerRefundId: { in: records.map((row) => row.id) } }, select: { providerRefundId: true, providerStatus: true } });
  const changes = records.filter((row) => !known.some((saved) => saved.providerRefundId === row.id && saved.providerStatus === row.status));
  let deferred = false;
  for (const refund of changes.slice(0, 20)) { const id = await importProviderRefund(matched.id, refund); if (!await reconcileProviderObject(id, refund)) deferred = true; }
  // Import the financial hold before publishing an out-of-order capture.
  await confirmStripePayment(matched.id, paymentId, matched.amount, "bdt");
  if (changes.length > 20) throw new RefundError("Provider refunds require another bounded reconciliation pass.", "REFUND_PROVIDER_HISTORY");
  return { orderId: matched.id, deferred };
}

async function incomingCapture(stripe: Stripe, id: string, metadataOrderId?: string) {
  const intent = await stripe.paymentIntents.retrieve(id), matched = await paymentOrder(id, intent.metadata.orderId ?? metadataOrderId);
  if (!matched) return null;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: matched.id }, select: { total: true } });
  if (intent.status !== "succeeded" || intent.metadata.orderId !== matched.id || intent.currency !== "bdt" || intent.amount_received !== cents(order.total)) throw new RefundError("Provider capture identity, currency or amount mismatch.", "REFUND_PROVIDER_MATCH");
  return { id: matched.id, amount: intent.amount_received };
}

export async function recoverMissingRefund(id: string, actor: AuthenticatedUser, version: number, evidence: string) {
  const candidate = await prisma.refund.findUnique({ where: { id }, select: { orderId: true } });
  if (!candidate) throw new RefundError("Refund not found.", "REFUND_NOT_FOUND", 404);
  const token = randomUUID();
  const claim = await financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, candidate.orderId, actor), row = await tx.refund.findUniqueOrThrow({ where: { id }, include: refundInclude });
    if (row.version !== version || row.status !== "REVIEW" || row.providerRefundId || row.paymentMethod !== "STRIPE" || !row.submittedAt || Date.now() - row.submittedAt.getTime() < 24 * 60 * 60_000 || (row.leaseUntil && row.leaseUntil > new Date())) throw new RefundError("Only an unclaimed, uncertain card attempt older than 24 hours can use missing-refund recovery.", "REFUND_STATE");
    await tx.refund.update({ where: { id }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 120_000), version: { increment: 1 } } });
    return { order, row };
  });
  try {
    const stripe = getStripe({ timeout: 4000, maxNetworkRetries: 0 }), intentId = await currentPayment(stripe, claim.order, claim.row.providerPaymentIntentId), history = await listRefunds(stripe, intentId);
    const actual = history.find((row) => row.metadata?.amarRefundId === id);
    if (actual) { await reconcileProviderObject(id, actual, token); return { orderId: candidate.orderId }; }
    await financeTransaction(async (tx) => {
      const order = await lockFinanceOrder(tx, candidate.orderId, actor); await lockFinanceProducts(tx, order);
      const row = await tx.refund.findUniqueOrThrow({ where: { id } });
      if (row.leaseToken !== token || row.providerRefundId) throw new RefundError("The attempt changed during recovery. Reload it.", "REFUND_CHANGED");
      await tx.refund.update({ where: { id }, data: { status: "CANCELLED", leaseToken: null, leaseUntil: null, nextCheckAt: null, errorCode: "PROVIDER_CONFIRMED_MISSING_AFTER_WINDOW", version: { increment: 1 } } });
      await financialEvent(tx, order.id, "MISSING_PROVIDER_REFUND_VERIFIED", evidence, actor); await reconcileRefundLedger(tx, order);
    });
    return { orderId: candidate.orderId };
  } catch (error) {
    await financeTransaction(async (tx) => {
      await lockFinanceOrder(tx, candidate.orderId);
      const row = await tx.refund.findUniqueOrThrow({ where: { id } });
      if (row.leaseToken === token) await tx.refund.update({ where: { id }, data: { leaseToken: null, leaseUntil: null, errorCode: "PROVIDER_RECOVERY_UNCONFIRMED", version: { increment: 1 } } });
    });
    if (error instanceof RefundError) throw error;
    throw new RefundError("Provider history could not be confirmed. The uncertain attempt remains reserved.", "REFUND_PROVIDER_UNAVAILABLE", 503);
  }
}

export async function handleDisputeWebhook(eventObject: Stripe.Dispute) {
  const stripe = getStripe({ timeout: 4000, maxNetworkRetries: 0 }), dispute = await stripe.disputes.retrieve(eventObject.id);
  const intentId = objectId(dispute.payment_intent);
  if (!intentId) return null;
  const intent = await stripe.paymentIntents.retrieve(intentId), matched = await paymentOrder(intentId, intent.metadata.orderId);
  if (!matched) return null;
  return financeTransaction(async (tx) => {
    const order = await lockFinanceOrder(tx, matched.id); await lockFinanceProducts(tx, order);
    if (intent.currency !== "bdt" || intent.amount_received !== cents(order.total) || intent.metadata.orderId !== order.id || dispute.currency !== "bdt" || !Number.isSafeInteger(dispute.amount) || dispute.amount < 0 || dispute.amount > cents(order.total)) throw new RefundError("Provider dispute amount, currency or capture mismatch.", "REFUND_PROVIDER_MATCH");
    const existing = await tx.paymentDispute.findUnique({ where: { id: dispute.id } });
    if (existing && existing.orderId !== order.id) throw new RefundError("Dispute belongs to another order.", "REFUND_PROVIDER_MATCH");
    const terminal = ["won", "lost", "warning_closed"].includes(dispute.status);
    if (existing && ["won", "lost", "warning_closed"].includes(existing.status) && !terminal) return { orderId: order.id, deferred: false };
    const balances = dispute.balance_transactions ?? [], withdrawn = balances.length ? Math.max(0, -balances.reduce((sum, row) => sum + row.amount, 0)) : dispute.amount;
    const lost = dispute.status === "lost" ? Math.min(dispute.amount, withdrawn) : 0;
    await tx.paymentDispute.upsert({ where: { id: dispute.id }, create: { id: dispute.id, orderId: order.id, status: dispute.status, amountCents: BigInt(dispute.amount), fundsLostCents: BigInt(lost) }, update: { status: dispute.status, amountCents: BigInt(dispute.amount), fundsLostCents: BigInt(lost) } });
    const all = await tx.paymentDispute.findMany({ where: { orderId: order.id } });
    const next = all.some((row) => row.status === "lost") ? "LOST" : all.some((row) => !["won", "warning_closed"].includes(row.status)) ? "ACTIVE" : "WON";
    await tx.order.update({ where: { id: order.id }, data: { disputeStatus: next, disputeAmountCents: all.reduce((sum, row) => sum + row.fundsLostCents, BigInt(0)), refundVersion: { increment: 1 }, fulfillmentVersion: { increment: 1 } } });
    await financialEvent(tx, order.id, "PAYMENT_DISPUTE_RECONCILED", `Provider dispute ${dispute.id}: ${dispute.status}`, undefined, dispute.amount);
    for (const productId of [...new Set(order.items.map((item) => item.productId))].sort()) {
      await reconcileProductReviews(tx, productId);
    }
    return { orderId: order.id, deferred: false };
  });
}
export async function sweepCardRefunds(limit = 5) {
  const rows = await prisma.refund.findMany({ where: { paymentMethod: "STRIPE", nextCheckAt: { lte: new Date() }, status: { in: [...ACTIVE_REFUND_STATES] } }, orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }], take: Math.min(10, Math.max(1, limit)), select: { id: true } });
  const summary = { checked: 0, reconciled: 0, deferred: 0, errors: 0 }; const deadline = Date.now() + 20_000;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    summary.checked++; try { const result = await processCardRefund(row.id); if (result.busyOrComplete) summary.deferred++; else summary.reconciled++; } catch { summary.errors++; }
  }
  return summary;
}
