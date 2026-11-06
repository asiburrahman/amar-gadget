import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import type { CheckoutInput } from "@/lib/validations/order";
import { cartCheckoutSchema, type CartCheckoutContext } from "@/lib/validations/cart";
import { CartError, lockCartActor, lockCartOwner } from "@/lib/cart";

/** Run after the attempt replay check and before any stock/order writes. */
export async function prepareCartCheckout(tx: Prisma.TransactionClient, input: CheckoutInput, actor: AuthenticatedUser | null): Promise<CartCheckoutContext | null> {
  const selection = input.cart ? { ...input.cart, previousReceiptId: input.cart.previousReceiptId ?? null } : undefined;
  if (selection && selection.ownerId !== (actor?.id ?? null)) {
    throw new CartError("The checkout account changed. Refresh your cart and shipping details.", "CART_ACCOUNT_CHANGED");
  }
  if (selection) {
    if (selection.lines.length !== input.items.length || input.items.some((item) => !selection.lines.some((line) => line.productId === item.productId && line.quantity === item.quantity))) {
      throw new CartError("The selected cart lines changed. Refresh before placing the order.", "CART_CHANGED");
    }
    if ((input.couponCode || null) !== selection.couponCode) throw new CartError("The cart coupon changed. Refresh your total.", "CART_CHANGED");
  }
  if (!actor) {
    if (!selection) return null;
    // A source identifier is a deduplication key, never permission to read an
    // order. Only the original checkout secret/cookie can reveal its receipt.
    const key = `guest-cart:${selection.sourceId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const [previous] = await tx.$queryRaw<{ id: string; acknowledged: Date | null; version: number }[]>`
      SELECT id,"cartAcknowledgedAt" AS acknowledged,("cartSnapshot"->>'version')::integer AS version FROM "Order"
      WHERE "cartSnapshot"->>'ownerId' IS NULL AND "cartSnapshot"->>'sourceId'=${selection.sourceId}
      ORDER BY ("cartSnapshot"->>'version')::integer DESC,"createdAt" DESC,id DESC LIMIT 1`;
    if (previous && (!previous.acknowledged || selection.previousReceiptId !== previous.id || selection.version <= previous.version)) {
      throw new CartError("This guest cart has an earlier checkout to confirm. Use its original tab or receipt before starting another.", "CART_GUEST_REVIEW");
    }
    if (!previous && selection.previousReceiptId !== null) throw new CartError("Guest cart receipt history changed. Review the original checkout.", "CART_GUEST_REVIEW");
    return selection;
  }
  const cart = await lockCartActor(tx, actor);
  const pending = await tx.order.findFirst({
    where: { userId: actor.id, status: "PENDING", paymentStatus: "UNPAID", cartSnapshot: { path: ["ownerId"], equals: actor.id } },
    select: { id: true },
  });
  if (pending) throw new CartError("This cart already has a reserved checkout. Resume that order before starting another.", "CART_HAS_PENDING", 409, pending.id);
  if (!selection) {
    // Legacy/manual callers with no server cart remain supported. A populated
    // account cart requires its real context, not a second unlinked checkout.
    if (await tx.cartLine.count({ where: { cartUserId: actor.id } })) throw new CartError("Load the current account cart before checking out.", "CART_CONTEXT_REQUIRED");
    return null;
  }
  if (selection.version !== cart.version || selection.couponVersion !== cart.couponVersion || selection.couponCode !== cart.couponCode) {
    throw new CartError("Your cart changed in another session. Refresh and review the new total.", "CART_CHANGED");
  }
  const lines = await tx.cartLine.findMany({ where: { cartUserId: actor.id, id: { in: selection.lines.map((line) => line.lineId) } } });
  if (selection.lines.some((line) => !lines.some((saved) => saved.id === line.lineId && saved.productId === line.productId && saved.quantity >= line.quantity))) {
    throw new CartError("A selected cart line was removed, replaced or changed. Refresh before checkout.", "CART_CHANGED");
  }
  return selection;
}

/** Caller holds the Order lock (or just inserted the order). Purchased line
 * identities are stable; removed/re-added lines and later additions survive. */
export async function consumeCartForOrder(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { userId: true, cartSnapshot: true, cartConsumedAt: true, status: true } });
  if (!order.cartSnapshot || order.cartConsumedAt || order.status === "CANCELLED") return false;
  const parsed = cartCheckoutSchema.safeParse(order.cartSnapshot);
  if (!parsed.success || (parsed.data.ownerId !== null && parsed.data.ownerId !== order.userId)) throw new CartError("Purchased cart snapshot requires support review.", "CART_REVIEW", 503);
  const receipt = parsed.data;
  if (receipt.ownerId) {
    const cart = await lockCartOwner(tx, receipt.ownerId);
    if (cart) {
      const purchased = JSON.stringify(receipt.lines);
      const removed = await tx.$executeRaw`
        WITH purchased AS (SELECT * FROM jsonb_to_recordset(${purchased}::jsonb) AS p("lineId" text,"productId" text,quantity integer))
        DELETE FROM "CartLine" l USING purchased p
        WHERE l."cartUserId"=${receipt.ownerId} AND l.id=p."lineId" AND l."productId"=p."productId" AND l.quantity<=p.quantity`;
      const reduced = await tx.$executeRaw`
        WITH purchased AS (SELECT * FROM jsonb_to_recordset(${purchased}::jsonb) AS p("lineId" text,"productId" text,quantity integer))
        UPDATE "CartLine" l SET quantity=l.quantity-p.quantity, version=l.version+1, "updatedAt"=CURRENT_TIMESTAMP
        FROM purchased p WHERE l."cartUserId"=${receipt.ownerId} AND l.id=p."lineId" AND l."productId"=p."productId" AND l.quantity>p.quantity`;
      const changed = removed + reduced > 0;
      const clearCoupon = changed && cart.couponVersion === receipt.couponVersion && cart.couponCode === receipt.couponCode && cart.couponCode !== null;
      if (changed || clearCoupon) await tx.cart.update({ where: { userId: receipt.ownerId }, data: {
        version: { increment: 1 }, ...(clearCoupon ? { couponCode: null, couponVersion: { increment: 1 } } : {}),
      } });
    }
  }
  await tx.order.update({ where: { id: orderId }, data: { cartConsumedAt: new Date() } });
  return true;
}

/** Called only after the existing checkout authorization has succeeded. This
 * acknowledges durable client receipt handling; it never confirms payment. */
export async function acknowledgeGuestCart(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const parsed = cartCheckoutSchema.safeParse(order.cartSnapshot);
  if (!parsed.success || parsed.data.ownerId !== null) throw new CartError("This order does not have a guest cart receipt.", "CART_REVIEW");
  const closed = order.status === "CANCELLED" || order.paymentStatus === "FAILED";
  const confirmed = order.status !== "CANCELLED" && (order.paymentStatus === "PAID" || (order.paymentMethod === "COD" && order.status !== "PENDING"));
  if (!closed && !confirmed) throw new CartError("Confirm or close this checkout before acknowledging its cart.", "CART_STILL_PENDING");
  if (!order.cartAcknowledgedAt) await tx.order.update({ where: { id: orderId }, data: { cartAcknowledgedAt: new Date() } });
  return true;
}
