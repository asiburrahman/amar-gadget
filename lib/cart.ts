import { createHash } from "node:crypto";
import { Prisma, type Cart } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { resolveWishlistProducts } from "@/lib/wishlist";
import { cartCheckoutSchema, MAX_CART_LINES, type AccountCartSnapshot, type CartMutation, type CartViewLine } from "@/lib/validations/cart";

export class CartError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409, readonly resumeOrderId?: string) { super(message); }
}

/** The same order is used by authenticated edits and trusted payment cleanup:
 * User, then Cart. Neither operation waits for an existing Order while locked. */
export async function lockCartOwner(tx: Prisma.TransactionClient, userId: string, create = false) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  if (create) await tx.cart.upsert({ where: { userId }, create: { userId }, update: {} });
  await tx.$queryRaw`SELECT "userId" FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE`;
  return tx.cart.findUnique({ where: { userId } });
}

export async function lockCartActor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
  const cart = await lockCartOwner(tx, actor.id, true);
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
  if (!current?.isVerified || current.role !== actor.role || current.sessionVersion !== actor.sessionVersion) {
    throw new CartError("Your account changed. Refresh your session.", "CART_ACCOUNT_CHANGED");
  }
  if (!cart) throw new CartError("Cart is unavailable. Refresh before retrying.", "CART_UNAVAILABLE", 503);
  return cart;
}

async function withCartActor<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient, cart: Cart) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
    const cart = await lockCartActor(tx, actor);
    return work(tx, cart);
  }, { timeout: 10_000, maxWait: 5000 });
}

export async function resolveCartLines(
  lines: { productId: string; lineId: string; quantity: number; version?: number }[],
  tx: Pick<Prisma.TransactionClient, "product"> = prisma,
): Promise<CartViewLine[]> {
  const entries = await resolveWishlistProducts(lines.map((line) => line.productId), tx);
  const products = new Map(entries.map((entry) => [entry.id, entry.product]));
  return lines.map((line) => ({ id: line.productId, lineId: line.lineId, lineVersion: line.version ?? 1, quantity: line.quantity, product: products.get(line.productId) ?? null }));
}

export async function readAccountCart(actor: AuthenticatedUser): Promise<AccountCartSnapshot> {
  return withCartActor(actor, async (tx, cart) => {
    const lines = await tx.cartLine.findMany({ where: { cartUserId: actor.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_CART_LINES + 1 });
    if (lines.length > MAX_CART_LINES) throw new CartError("This cart needs operator review before it can be loaded.", "CART_LIMIT", 503);
    const pending = await tx.order.findMany({
      where: { userId: actor.id, status: "PENDING", paymentStatus: "UNPAID", cartSnapshot: { path: ["ownerId"], equals: actor.id } },
      select: { id: true, cartSnapshot: true }, orderBy: { createdAt: "asc" }, take: 2,
    });
    if (pending.length > 1) throw new CartError("Reserved cart checkouts need support review.", "CART_REVIEW", 503);
    const pendingCheckouts: AccountCartSnapshot["pendingCheckouts"] = {};
    for (const order of pending) {
      const parsed = cartCheckoutSchema.safeParse(order.cartSnapshot);
      if (!parsed.success || parsed.data.ownerId !== actor.id) throw new CartError("Reserved cart checkout needs support review.", "CART_REVIEW", 503);
      const receipt = parsed.data;
      pendingCheckouts[order.id] = { items: receipt.lines, couponCode: receipt.couponCode, couponVersion: receipt.couponVersion, ownerId: receipt.ownerId, sourceId: receipt.sourceId, version: receipt.version };
    }
    // A COD response can be lost after its cart was consumed. A bounded recent
    // owned receipt prevents an empty cart being mistaken for "no order".
    const recent = await tx.order.findFirst({
      where: { userId: actor.id, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) }, cartSnapshot: { path: ["ownerId"], equals: actor.id } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, status: true, paymentStatus: true, paymentMethod: true, createdAt: true },
    });
    return {
      ownerId: actor.id, version: cart.version, couponCode: cart.couponCode, couponVersion: cart.couponVersion,
      lines: await resolveCartLines(lines.map((line) => ({ productId: line.productId, lineId: line.id, quantity: line.quantity, version: line.version })), tx), pendingCheckouts,
      recentCheckout: recent ? { ...recent, createdAt: recent.createdAt.toISOString() } : null,
    };
  });
}

export type CartMutationResult = { ownerId: string; requestId: string; version: number; changed: boolean; acceptedIds: string[]; skippedIds: string[] };

export async function mutateAccountCart(actor: AuthenticatedUser, input: CartMutation) {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return withCartActor(actor, async (tx, cart) => {
    // Retry the same most-recent request without another quantity increase.
    // If another edit has intervened, the old version rejects rather than
    // replaying an uncertain increment against the newer cart.
    if (cart.lastRequestId === input.requestId) {
      if (cart.lastRequestHash !== hash || !cart.lastResult) throw new CartError("This cart request belongs to different changes. Refresh your cart.", "CART_REQUEST_CONFLICT");
      return cart.lastResult as CartMutationResult;
    }
    if (cart.version !== input.version) throw new CartError("Your cart changed in another session. Refresh and review it before retrying.", "CART_CHANGED");
    let changed = false;
    const acceptedIds: string[] = [], skippedIds: string[] = [];
    if (input.action === "set") {
      const existing = await tx.cartLine.findUnique({ where: { cartUserId_productId: { cartUserId: actor.id, productId: input.productId } } });
      if ((existing?.id ?? null) !== input.lineId) throw new CartError("This cart line was replaced. Refresh before editing it.", "CART_CHANGED");
      if (!existing || input.quantity > existing.quantity) {
        const product = await tx.product.findFirst({ where: { id: input.productId, ...publicProductWhere }, select: { stock: true } });
        if (!product || product.stock < input.quantity) throw new CartError("The product is unavailable in that quantity. Refresh the cart to check current stock.", "CART_STOCK_CHANGED");
      }
      if (!existing) {
        if (await tx.cartLine.count({ where: { cartUserId: actor.id } }) >= MAX_CART_LINES) throw new CartError("A cart can hold up to 100 different products.", "CART_LIMIT");
        await tx.cartLine.create({ data: { cartUserId: actor.id, productId: input.productId, quantity: input.quantity } });
        changed = true;
      } else if (existing.quantity !== input.quantity) {
        await tx.cartLine.update({ where: { id: existing.id }, data: { quantity: input.quantity, version: { increment: 1 } } });
        changed = true;
      }
      acceptedIds.push(input.productId);
    } else if (input.action === "remove") {
      const removed = await tx.cartLine.deleteMany({ where: { cartUserId: actor.id, id: input.lineId } });
      changed = removed.count > 0;
    } else if (input.action === "clear") {
      const removed = await tx.cartLine.deleteMany({ where: { cartUserId: actor.id } });
      changed = removed.count > 0 || cart.couponCode !== null;
      if (cart.couponCode !== null) await tx.cart.update({ where: { userId: actor.id }, data: { couponCode: null, couponVersion: { increment: 1 } } });
    } else if (input.action === "coupon") {
      // This is a requested code, not a claim that a discount is valid. The
      // server quote remains authoritative. Explicit reapplication is a new
      // coupon intent even when its text matches a reserved order's code.
      if (input.code !== null || cart.couponCode !== input.code) {
        await tx.cart.update({ where: { userId: actor.id }, data: { couponCode: input.code, couponVersion: { increment: 1 } } });
        changed = true;
      }
    } else {
      const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) }, ...publicProductWhere }, select: { id: true, stock: true } });
      const lines = await tx.cartLine.findMany({ where: { cartUserId: actor.id } });
      if (lines.length > MAX_CART_LINES) throw new CartError("This cart needs operator review before merging.", "CART_LIMIT");
      let count = lines.length;
      for (const item of input.items) {
        const product = products.find((row) => row.id === item.productId), existing = lines.find((line) => line.productId === item.productId);
        const quantity = Math.max(item.quantity, existing?.quantity ?? 0);
        if (!product || product.stock < quantity || (!existing && count >= MAX_CART_LINES)) { skippedIds.push(item.productId); continue; }
        if (!existing) {
          await tx.cartLine.create({ data: { cartUserId: actor.id, productId: item.productId, quantity } }); count++; changed = true;
        } else if (quantity !== existing.quantity) {
          await tx.cartLine.update({ where: { id: existing.id }, data: { quantity, version: { increment: 1 } } }); changed = true;
        }
        acceptedIds.push(item.productId);
      }
    }
    const result: CartMutationResult = { ownerId: actor.id, requestId: input.requestId, version: cart.version + (changed ? 1 : 0), changed, acceptedIds, skippedIds };
    await tx.cart.update({ where: { userId: actor.id }, data: {
      ...(changed ? { version: { increment: 1 } } : {}), lastRequestId: input.requestId, lastRequestHash: hash, lastResult: result,
    } });
    return result;
  });
}
