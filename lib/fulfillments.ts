import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { FulfillmentError, aggregateFulfillmentState, type FulfillmentState } from "@/lib/fulfillment-policy";
import { fulfillmentMutationSchema, wholeOrderMutationSchema, fulfillmentQuerySchema, FULFILLMENT_PAGE_SIZE, type SellerFulfillment, type CustomerFulfillment } from "@/lib/validations/fulfillment";
import { isPublicProductImageUrl } from "@/lib/product-media-policy";
import { reconcileProductReviews } from "@/lib/reviews";
import { reconcileReservation } from "@/lib/checkout-reservations";

const itemSelect = { id: true, productId: true, quantity: true, price: true, product: { select: { name: true, imageUrl: true } } } satisfies Prisma.OrderItemSelect;
const shipmentSelect = {
  id: true, orderId: true, sellerId: true, status: true, version: true, carrier: true, trackingNumber: true,
  shippedAt: true, deliveredAt: true, legacySnapshot: true, createdAt: true, codCollected: true, codCollectedAt: true,
  order: { select: { status: true, fulfillmentVersion: true, paymentMethod: true, paymentStatus: true, trackingNumber: true, shippingAddress: true, shippingPhone: true, reservationReviewReason: true } },
  items: { orderBy: { id: "asc" }, select: itemSelect },
} satisfies Prisma.OrderFulfillmentSelect;
type ShipmentRow = Prisma.OrderFulfillmentGetPayload<{ select: typeof shipmentSelect }>;
function sellerDto(row: ShipmentRow): SellerFulfillment {
  return {
    id: row.id, orderId: row.orderId, orderTrackingCode: row.order.trackingNumber, status: row.status as FulfillmentState, version: row.version,
    orderStatus: row.order.status as SellerFulfillment["orderStatus"], paymentMethod: row.order.paymentMethod as "COD" | "STRIPE", paymentStatus: row.order.paymentMethod === "COD" ? row.codCollected ? "PAID" : "UNPAID" : row.order.paymentStatus,
    codCollectedAt: row.codCollectedAt?.toISOString() ?? null,
    recipientAddress: row.order.shippingAddress, recipientPhone: row.order.shippingPhone,
    carrier: row.carrier, trackingNumber: row.trackingNumber, shippedAt: row.shippedAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null,
    legacySnapshot: row.legacySnapshot, createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({ id: item.id, productId: item.productId, name: item.product.name, imageUrl: item.product.imageUrl && isPublicProductImageUrl(item.product.imageUrl) ? item.product.imageUrl : null, quantity: item.quantity, unitPrice: Number(item.price) })),
  };
}
export const customerShipmentSelect = { id: true, status: true, carrier: true, trackingNumber: true, shippedAt: true, deliveredAt: true, legacySnapshot: true, items: { select: { id: true } } } satisfies Prisma.OrderFulfillmentSelect;
export function customerShipment(row: Prisma.OrderFulfillmentGetPayload<{ select: typeof customerShipmentSelect }>): CustomerFulfillment {
  return { id: row.id, status: row.status as FulfillmentState, carrier: row.carrier, trackingNumber: row.trackingNumber, shippedAt: row.shippedAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null, legacySnapshot: row.legacySnapshot, itemIds: row.items.map((i) => i.id) };
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, repeatableRead = false) {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout='3000ms'`; return work(tx); }, { timeout: 10_000, maxWait: 5000, ...(repeatableRead ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } : {}) });
}
async function lockActor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sellerStatus: true, sessionVersion: true } });
  if (!user?.isVerified || user.role !== actor.role || user.sessionVersion !== actor.sessionVersion) throw new FulfillmentError("Your account changed. Reload your session before managing shipments.", "FULFILLMENT_ACCOUNT_CHANGED");
  if (user.role !== "ADMIN" && (user.role !== "MEMBER" || user.sellerStatus !== "APPROVED")) throw new FulfillmentError("Shipment management is not available for this account.", "FORBIDDEN", 403);
  return user;
}
async function auditActor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
  await tx.$queryRaw`SELECT set_config('amar.fulfillment_actor_id',${actor.id},true),set_config('amar.fulfillment_actor_role',${actor.role},true)`;
}
async function lockShipment(tx: Prisma.TransactionClient, actor: AuthenticatedUser, id: string, version: number) {
  const candidate = await tx.orderFulfillment.findUnique({ where: { id }, select: { orderId: true, sellerId: true } });
  if (!candidate || (actor.role !== "ADMIN" && candidate.sellerId !== actor.id)) throw new FulfillmentError("Shipment not found.", "FULFILLMENT_NOT_FOUND", 404);
  // Payment/reservation/review writers take Order before User. Keep this same
  // direction before the individual shipment and any later product locks.
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${candidate.orderId} FOR UPDATE`;
  await lockActor(tx, actor);
  await tx.$queryRaw`SELECT id FROM "OrderFulfillment" WHERE id=${id} FOR UPDATE`;
  const row = await tx.orderFulfillment.findUnique({ where: { id }, select: shipmentSelect });
  if (!row || !row.items.length || (actor.role !== "ADMIN" && row.sellerId !== actor.id)) throw new FulfillmentError("Shipment not found.", "FULFILLMENT_NOT_FOUND", 404);
  if (row.version !== version) throw new FulfillmentError("This shipment changed in another session. Reload it before retrying.", "FULFILLMENT_CHANGED");
  await auditActor(tx, actor);
  return row;
}
async function reconcileOrder(tx: Prisma.TransactionClient, orderId: string) {
  const shipments = await tx.orderFulfillment.findMany({ where: { orderId, items: { some: {} } }, orderBy: { id: "asc" }, select: { status: true, carrier: true, trackingNumber: true, codCollected: true } });
  const status = aggregateFulfillmentState(shipments.map((row) => row.status));
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentMethod: true } });
  await tx.order.update({ where: { id: orderId }, data: { status, fulfillmentVersion: { increment: 1 }, ...(order.paymentMethod === "COD" ? { paymentStatus: shipments.every((row) => row.status === "DELIVERED" && row.codCollected) ? "PAID" : "UNPAID" } : {}), shippingCarrier: shipments.length === 1 ? shipments[0].carrier : null, shipmentTrackingNumber: shipments.length === 1 ? shipments[0].trackingNumber : null } });
}
export async function readSellerFulfillments(actor: AuthenticatedUser, input: unknown = {}) {
  const query = fulfillmentQuerySchema.parse(input);
  return transaction(async (tx) => {
    await lockActor(tx, actor);
    // Admins use their dedicated order view rather than impersonating a seller.
    if (actor.role !== "MEMBER") throw new FulfillmentError("Use administrator shipment management.", "FORBIDDEN", 403);
    const where: Prisma.OrderFulfillmentWhereInput = { sellerId: actor.id, items: { some: {} }, ...(query.orderId ? { orderId: query.orderId } : {}), ...(query.status !== "ALL" ? { status: query.status } : {}) };
    const total = await tx.orderFulfillment.count({ where }), totalPages = Math.max(1, Math.ceil(total / FULFILLMENT_PAGE_SIZE));
    if (query.page > totalPages) throw new FulfillmentError("This shipment page does not exist.", "FULFILLMENT_PAGE", 404);
    const rows = await tx.orderFulfillment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * FULFILLMENT_PAGE_SIZE, take: FULFILLMENT_PAGE_SIZE, select: shipmentSelect });
    return { ownerId: actor.id, page: query.page, total, totalPages, shipments: rows.map(sellerDto) };
  }, true);
}
export async function readAdminFulfillments(actor: AuthenticatedUser, input: unknown = {}) {
  const query = fulfillmentQuerySchema.parse(input);
  return transaction(async (tx) => {
    await lockActor(tx, actor);
    if (actor.role !== "ADMIN") throw new FulfillmentError("Administrator access is required.", "FORBIDDEN", 403);
    const where: Prisma.OrderFulfillmentWhereInput = { items: { some: {} }, ...(query.orderId ? { orderId: query.orderId } : {}), ...(query.status !== "ALL" ? { status: query.status } : {}) };
    const total = await tx.orderFulfillment.count({ where }), totalPages = Math.max(1, Math.ceil(total / FULFILLMENT_PAGE_SIZE));
    if (query.page > totalPages) throw new FulfillmentError("This shipment page does not exist.", "FULFILLMENT_PAGE", 404);
    const rows = await tx.orderFulfillment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * FULFILLMENT_PAGE_SIZE, take: FULFILLMENT_PAGE_SIZE, select: { ...shipmentSelect, seller: { select: { id: true, name: true, email: true, sellerStatus: true } }, order: { select: { ...shipmentSelect.order.select, total: true } } } });
    return { ownerId: actor.id, page: query.page, total, totalPages, shipments: rows.map((row) => ({ ...sellerDto(row), seller: row.seller, orderTotal: Number(row.order.total), orderVersion: row.order.fulfillmentVersion })) };
  }, true);
}
export async function readFulfillmentHistory(actor: AuthenticatedUser, fulfillmentId: string, cursor?: string) {
  return transaction(async (tx) => {
    const candidate = await tx.orderFulfillment.findUnique({ where: { id: fulfillmentId }, select: { version: true } });
    if (!candidate) throw new FulfillmentError("Shipment not found.", "FULFILLMENT_NOT_FOUND", 404);
    const row = await lockShipment(tx, actor, fulfillmentId, candidate.version);
    if (cursor && !await tx.fulfillmentEvent.findFirst({ where: { id: cursor, fulfillmentId }, select: { id: true } })) throw new FulfillmentError("History position not found. Reload the shipment history.", "FULFILLMENT_HISTORY", 404);
    const events = await tx.fulfillmentEvent.findMany({ where: { fulfillmentId }, orderBy: { sequence: "asc" }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const page = events.slice(0, 50);
    return { ownerId: actor.id, fulfillmentId, version: row.version, nextCursor: events.length > 50 ? page[page.length - 1].id : null,
      events: page.map((event) => ({ id: event.id, kind: event.kind, status: event.status as FulfillmentState, carrier: event.carrier, trackingNumber: event.trackingNumber, codCollected: event.codCollected, actorRole: event.actorRole, ...(actor.role === "ADMIN" ? { actorId: event.actorId } : {}), occurredAt: event.occurredAt?.toISOString() ?? null, recordedAt: event.recordedAt.toISOString() })) };
  });
}
export async function mutateFulfillment(actor: AuthenticatedUser, input: unknown) {
  const parsed = fulfillmentMutationSchema.parse(input);
  return transaction(async (tx) => {
    const row = await lockShipment(tx, actor, parsed.fulfillmentId, parsed.version);
    if (parsed.action === "deliver" || parsed.action === "collect-cod") {
      if (actor.role !== "ADMIN") throw new FulfillmentError("Only an administrator can confirm delivery and COD collection.", "FORBIDDEN", 403);
      if (row.order.status === "CANCELLED" || row.order.reservationReviewReason) throw new FulfillmentError("This order requires reconciliation before delivery.", "FULFILLMENT_PAYMENT");
      const cod = row.order.paymentMethod === "COD";
      if (cod && !parsed.codMoneyReceived) throw new FulfillmentError("Confirm receipt of this shipment's COD money before marking it delivered.", "FULFILLMENT_COD_CONFIRMATION", 400);
      if (!cod && (parsed.codMoneyReceived || row.order.paymentMethod !== "STRIPE" || row.order.paymentStatus !== "PAID")) throw new FulfillmentError("Card delivery requires verified card payment; COD collection does not apply.", "FULFILLMENT_PAYMENT");
      if (parsed.action === "deliver" ? row.status !== "SHIPPED" : !cod || row.status !== "DELIVERED" || row.codCollected) throw new FulfillmentError("Reload the shipment. Delivery requires a shipped package; collection applies only to delivered, uncollected COD packages.", "FULFILLMENT_STATE");
      const now = new Date();
      await tx.orderFulfillment.update({ where: { id: row.id }, data: { version: { increment: 1 }, ...(parsed.action === "deliver" ? { status: "DELIVERED", deliveredAt: now } : {}), ...(cod ? { codCollected: true, codCollectedAt: now } : {}) } });
      await reconcileOrder(tx, row.orderId);
      // Eligibility is per delivered and paid shipment. Keep published ratings
      // consistent in the same transaction, with the review lock order.
      for (const productId of [...new Set(row.items.map((item) => item.productId))].sort()) {
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
        await reconcileProductReviews(tx, productId);
      }
      const saved = await tx.orderFulfillment.findUniqueOrThrow({ where: { id: row.id }, select: shipmentSelect });
      return { ownerId: actor.id, shipment: sellerDto(saved) };
    }
    if (!['PROCESSING', 'SHIPPED'].includes(row.status) || row.order.status === "CANCELLED") throw new FulfillmentError("Only an active processing or shipped shipment can be changed.", "FULFILLMENT_STATE");
    if (!["COD", "STRIPE"].includes(row.order.paymentMethod)) throw new FulfillmentError("This payment method requires operator review.", "FULFILLMENT_PAYMENT");
    if (row.order.reservationReviewReason || (row.order.paymentMethod === "STRIPE" && row.order.paymentStatus !== "PAID")) throw new FulfillmentError("Card payment must be confirmed and reconciliation cleared before shipment.", "FULFILLMENT_PAYMENT");
    if (parsed.action === "ship" && row.status !== "PROCESSING") throw new FulfillmentError("This shipment has already advanced. Reload its saved state.", "FULFILLMENT_STATE");
    if (parsed.action === "tracking" && row.carrier === parsed.carrier && row.trackingNumber === parsed.trackingNumber) return { ownerId: actor.id, shipment: sellerDto(row) };
    await tx.orderFulfillment.update({ where: { id: row.id }, data: { carrier: parsed.carrier, trackingNumber: parsed.trackingNumber, version: { increment: 1 }, ...(parsed.action === "ship" ? { status: "SHIPPED", shippedAt: new Date() } : {}) } });
    await reconcileOrder(tx, row.orderId);
    const saved = await tx.orderFulfillment.findUniqueOrThrow({ where: { id: row.id }, select: shipmentSelect });
    return { ownerId: actor.id, shipment: sellerDto(saved) };
  });
}

/** Whole-order actions never ship or deliver a vendor's individual package. */
export async function mutateWholeOrder(actor: AuthenticatedUser, input: unknown) {
  const parsed = wholeOrderMutationSchema.parse(input);
  if (actor.role !== "ADMIN" || parsed.ownerId !== actor.id) throw new FulfillmentError("The administrator account changed. Reload your session.", "FULFILLMENT_ACCOUNT_CHANGED", 403);
  const authorize = async (tx: Prisma.TransactionClient) => {
    await lockActor(tx, actor);
    const row = await tx.order.findUnique({ where: { id: parsed.orderId }, include: { items: { select: { productId: true, quantity: true } }, fulfillments: { select: { status: true, codCollected: true } } } });
    if (!row || !row.items.length) throw new FulfillmentError("Order not found.", "FULFILLMENT_NOT_FOUND", 404);
    if (row.fulfillmentVersion !== parsed.version) throw new FulfillmentError("This order changed. Reload it before retrying.", "FULFILLMENT_CHANGED");
    if (!["PENDING", "PROCESSING"].includes(row.status) || row.fulfillments.some((group) => !["PENDING", "PROCESSING"].includes(group.status) || group.codCollected)) throw new FulfillmentError("Dispatched or delivered shipments cannot be cancelled or reset by whole-order controls.", "FULFILLMENT_STATE");
    if (row.reservationReviewReason && row.paymentMethod !== "STRIPE") throw new FulfillmentError("Review this order's reconciliation state first.", "FULFILLMENT_PAYMENT");
    if (parsed.action === "confirm" && (row.status !== "PENDING" || (row.paymentMethod === "STRIPE" && row.paymentStatus !== "PAID"))) throw new FulfillmentError("Only a pending order with eligible payment can be confirmed.", "FULFILLMENT_PAYMENT");
    if (parsed.action === "cancel" && row.paymentStatus === "PAID") throw new FulfillmentError("Paid orders require the refund workflow before cancellation.", "FULFILLMENT_PAYMENT");
    await auditActor(tx, actor);
    return row;
  };
  const result = await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${parsed.orderId} FOR UPDATE`;
    const row = await authorize(tx);
    if (parsed.action === "cancel" && row.paymentMethod === "STRIPE") return null;
    if (parsed.action === "cancel") {
      for (const item of [...row.items].sort((a, b) => a.productId.localeCompare(b.productId))) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    }
    return tx.order.update({ where: { id: row.id }, data: { status: parsed.action === "cancel" ? "CANCELLED" : "PROCESSING" }, select: { id: true, status: true, paymentStatus: true, fulfillmentVersion: true } });
  });
  if (result) return result;
  // Provider work stays outside a database transaction. Positive payment truth
  // is still recorded, but an expiry releases stock only after rechecking the
  // original administrator and observed order revision under the Order lock.
  const reconciled = await reconcileReservation(parsed.orderId, new Date(), true, async (tx) => { await authorize(tx); });
  if (reconciled !== "released") throw new FulfillmentError("Payment could not be safely cancelled. Reload the order and review its provider state.", "FULFILLMENT_PAYMENT");
  return prisma.order.findUniqueOrThrow({ where: { id: parsed.orderId }, select: { id: true, status: true, paymentStatus: true, fulfillmentVersion: true } });
}
