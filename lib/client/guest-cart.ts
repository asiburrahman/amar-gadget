import { z } from "zod";
import { cartCheckoutSchema, cartCouponSchema, cartSelectionLineSchema, cartVersionSchema, MAX_CART_LINES, type CartCheckoutContext } from "@/lib/validations/cart";

export const GUEST_CART_KEY = "amar-gadget-cart-guest-v3";
export const LEGACY_CART_KEY = "amar-gadget-cart";
const guestLineSchema = cartSelectionLineSchema.extend({ version: cartVersionSchema.min(1) }).strict();
const guestReceiptSchema = z.object({ orderId: z.string().uuid(), context: cartCheckoutSchema }).strict();
export const guestCartSchema = z.object({
  id: z.string().uuid(), revision: cartVersionSchema, version: cartVersionSchema,
  couponCode: cartCouponSchema, couponVersion: cartVersionSchema,
  lines: z.array(guestLineSchema).max(MAX_CART_LINES),
  pending: z.array(guestReceiptSchema).max(20),
  previousReceiptId: z.string().uuid().nullable(), settledVersion: z.number().int().min(-1).max(2_147_483_646),
  ackPending: z.object({ orderId: z.string().uuid(), version: cartVersionSchema }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  const invalid = new Set(value.lines.map((line) => line.productId)).size !== value.lines.length
    || new Set(value.lines.map((line) => line.lineId)).size !== value.lines.length
    || new Set(value.pending.map((receipt) => receipt.orderId)).size !== value.pending.length
    || value.pending.some((receipt) => receipt.context.ownerId !== null || receipt.context.sourceId !== value.id || receipt.context.version > value.version)
    || value.settledVersion > value.version
    || (value.ackPending !== null && (value.ackPending.version !== value.settledVersion || value.pending.some((receipt) => receipt.orderId !== value.ackPending!.orderId)));
  if (invalid) ctx.addIssue({ code: "custom", message: "Guest cart history needs review." });
});
export type GuestCart = z.infer<typeof guestCartSchema>;
export type GuestCartLine = GuestCart["lines"][number];
export class GuestCartError extends Error {
  constructor(message: string, readonly code?: "CART_CHANGED" | "STORAGE_CONFLICT") { super(message); }
}

function next(value: number) {
  if (value >= 2_147_483_646) throw new GuestCartError("This cart reached its revision limit. Contact support before changing it.");
  return value + 1;
}
export function emptyGuestCart(id = globalThis.crypto.randomUUID()): GuestCart {
  return { id, revision: 0, version: 0, couponCode: null, couponVersion: 0, lines: [], pending: [], previousReceiptId: null, settledVersion: -1, ackPending: null };
}
export function guestCheckoutContext(cart: GuestCart): CartCheckoutContext {
  if (cart.pending.length || cart.ackPending) throw new GuestCartError("Confirm or close the earlier guest checkout before starting another.");
  return cartCheckoutSchema.parse({ ownerId: null, sourceId: cart.id, version: cart.version, couponCode: cart.couponCode, couponVersion: cart.couponVersion, lines: cart.lines.map(({ productId, lineId, quantity }) => ({ productId, lineId, quantity })), previousReceiptId: cart.previousReceiptId });
}
/** Catalog/stock eligibility is checked by the caller before an increase. This
 * transition accepts only IDs and quantities, never cached product metadata. */
export function setGuestQuantity(cart: GuestCart, productId: string, quantity: number, newLineId = globalThis.crypto.randomUUID()): GuestCart {
  const existing = cart.lines.find((line) => line.productId === productId);
  const parsed = guestLineSchema.parse({ productId, lineId: existing?.lineId ?? newLineId, quantity, version: existing ? next(existing.version) : 1 });
  if (existing?.quantity === quantity) return cart;
  if (!existing && cart.lines.length >= MAX_CART_LINES) throw new GuestCartError("A cart can hold up to 100 different products.");
  return { ...cart, version: next(cart.version), lines: existing ? cart.lines.map((line) => line.lineId === existing.lineId ? parsed : line) : [...cart.lines, parsed] };
}
export function removeGuestLine(cart: GuestCart, lineId: string): GuestCart {
  if (!cart.lines.some((line) => line.lineId === lineId)) return cart;
  return { ...cart, version: next(cart.version), lines: cart.lines.filter((line) => line.lineId !== lineId) };
}
export function setGuestCoupon(cart: GuestCart, value: string | null): GuestCart {
  const couponCode = cartCouponSchema.parse(value);
  if (couponCode === null && cart.couponCode === null) return cart;
  return { ...cart, version: next(cart.version), couponVersion: next(cart.couponVersion), couponCode };
}
export function clearGuestItems(cart: GuestCart): GuestCart {
  if (!cart.lines.length && cart.couponCode === null) return cart;
  return { ...cart, version: next(cart.version), lines: [], couponCode: null, couponVersion: cart.couponCode === null ? cart.couponVersion : next(cart.couponVersion) };
}
export function rememberGuestReceipt(cart: GuestCart, orderId: string, value: CartCheckoutContext): GuestCart {
  const receipt = guestReceiptSchema.parse({ orderId, context: value }), context = receipt.context;
  if (context.ownerId !== null || context.sourceId !== cart.id) throw new GuestCartError("This receipt belongs to a different cart.");
  if (context.version <= cart.settledVersion || cart.pending.some((entry) => entry.orderId === orderId)) return cart;
  if (cart.ackPending || cart.pending.length) throw new GuestCartError("An earlier guest receipt needs review before this receipt can be saved.");
  return { ...cart, version: Math.max(cart.version, context.version), pending: [receipt] };
}
/** Only call after an authorized server response confirms purchase or closure.
 * The durable local transition happens BEFORE acknowledging the server receipt.
 * A removed/re-added line, extra quantities and re-applied coupons survive. */
export function settleGuestReceipt(cart: GuestCart, orderId: string, value: CartCheckoutContext, outcome: "purchased" | "closed"): GuestCart {
  const receipt = guestReceiptSchema.parse({ orderId, context: value }), context = receipt.context;
  if (context.ownerId !== null || context.sourceId !== cart.id) throw new GuestCartError("This receipt belongs to a different cart.");
  if (context.version <= cart.settledVersion) return cart;
  if (cart.ackPending || cart.pending.some((entry) => entry.orderId !== orderId)) throw new GuestCartError("An earlier guest receipt must be handled first.");
  let changed = false;
  const lines = outcome === "closed" ? cart.lines : cart.lines.flatMap((line) => {
    const purchased = context.lines.find((entry) => entry.lineId === line.lineId && entry.productId === line.productId)?.quantity ?? 0;
    if (!purchased) return [line];
    changed = true;
    return line.quantity > purchased ? [{ ...line, quantity: line.quantity - purchased, version: next(line.version) }] : [];
  });
  const clearCoupon = changed && context.couponCode !== null && context.couponCode === cart.couponCode && context.couponVersion === cart.couponVersion;
  return { ...cart, version: next(Math.max(cart.version, context.version)), settledVersion: context.version,
    lines, pending: [], ackPending: { orderId, version: context.version },
    ...(clearCoupon ? { couponCode: null, couponVersion: next(cart.couponVersion) } : {}),
  };
}
export function acknowledgeGuestReceipt(cart: GuestCart, orderId: string): GuestCart {
  if (cart.ackPending?.orderId !== orderId) return cart;
  return { ...cart, previousReceiptId: orderId, ackPending: null };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Dependencies = { storage: () => StorageLike | undefined; lock?: <T>(work: () => Promise<T>) => Promise<T>; newId?: () => string };
/** Web Locks serialize supported browsers. Else optimistic revision checks
 * detect observed conflicts; localStorage alone cannot promise atomic CAS. */
export function createGuestCartRepository(deps: Dependencies) {
  let memory: GuestCart | undefined, memoryOnly = false, baseRaw: string | null | undefined;
  const clone = (value: GuestCart) => structuredClone(value);
  function read(): GuestCart {
    if (memoryOnly && memory) return clone(memory);
    let raw: string | null;
    try {
      const storage = deps.storage();
      if (!storage) throw new Error("Storage unavailable");
      raw = storage.getItem(GUEST_CART_KEY);
    } catch {
      memoryOnly = true;
      memory ??= emptyGuestCart(deps.newId?.());
      return clone(memory);
    }
    if (raw !== null) {
      if (raw.length > 262_144) throw new GuestCartError("Stored guest cart is too large. It was retained for review.");
      try { memory = guestCartSchema.parse(JSON.parse(raw)); }
      catch { throw new GuestCartError("Stored guest cart is invalid. It was retained; review it before starting another checkout."); }
      baseRaw = raw;
    } else {
      // Do not resurrect a stale in-memory cart after another tab clears it.
      if (baseRaw !== null || !memory) memory = emptyGuestCart(deps.newId?.());
      baseRaw = null;
    }
    return clone(memory!);
  }
  function write(value: GuestCart): boolean {
    memory = guestCartSchema.parse(value);
    try {
      const storage = deps.storage();
      if (!storage) throw new Error("Storage unavailable");
      const observed = storage.getItem(GUEST_CART_KEY);
      if (observed !== (baseRaw ?? null)) throw new GuestCartError("Guest cart changed in another tab. Keep this tab open and review both carts before retrying storage.", "STORAGE_CONFLICT");
      const raw = JSON.stringify(memory);
      storage.setItem(GUEST_CART_KEY, raw);
      baseRaw = raw; memoryOnly = false; return true;
    } catch (error) {
      memoryOnly = true;
      if (error instanceof GuestCartError) throw error;
      return false;
    }
  }
  async function locked<T>(work: () => Promise<T>) {
    if (!deps.lock) return work();
    let entered = false;
    try { return await deps.lock(() => { entered = true; return work(); }); }
    catch (error) { if (!entered) return work(); throw error; }
  }
  return {
    read,
    isMemoryOnly: () => memoryOnly,
    /** Persist even an empty source ID, so another tab shares its dedup key. */
    initialize: () => locked(async () => { const value = read(); const durable = write(value); return { cart: clone(value), durable }; }),
    change: (expected: Pick<GuestCart, "id" | "revision">, transform: (cart: GuestCart) => GuestCart) => locked(async () => {
      const current = read();
      if (current.id !== expected.id || current.revision !== expected.revision) throw new GuestCartError("Guest cart changed in another tab. Refresh before changing it.", "CART_CHANGED");
      const nextCart = transform(clone(current));
      if (JSON.stringify(nextCart) === JSON.stringify(current)) return { cart: current, durable: !memoryOnly && baseRaw != null };
      const value = guestCartSchema.parse({ ...nextCart, revision: next(current.revision) });
      const durable = write(value); return { cart: clone(value), durable };
    }),
    flush: () => locked(async () => { const cart = memoryOnly && memory ? clone(memory) : read(); return { cart, durable: write(cart) }; }),
  };
}
