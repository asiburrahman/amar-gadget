import { Prisma } from "@prisma/client";

export class RefundError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
export const ACTIVE_REFUND_STATES = ["QUEUED", "SUBMITTING", "PENDING", "REQUIRES_ACTION", "REVIEW"] as const;
export function cents(value: Prisma.Decimal | string | number | bigint): number {
  const result = typeof value === "bigint" ? Number(value) : Number(new Prisma.Decimal(value).mul(100).toFixed(0));
  if (!Number.isSafeInteger(result) || result < 0) throw new RefundError("The recorded amount requires financial review.", "REFUND_MONEY");
  return result;
}
export function integerCents(value: bigint | number) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new RefundError("The recorded amount requires financial review.", "REFUND_MONEY");
  return result;
}
export function proportional(amount: number, numerator: number, denominator: number) {
  if (![amount, numerator, denominator].every((n) => Number.isSafeInteger(n) && n >= 0) || numerator > denominator || denominator === 0) throw new RefundError("The allocation requires financial review.", "REFUND_MONEY");
  return Number(BigInt(amount) * BigInt(numerator) / BigInt(denominator));
}
/** Largest remainders, with immutable IDs as ties, conserve every paisa. */
export function allocateDiscount(lines: { id: string; grossCents: number }[], discountCents: number) {
  if (!lines.length || new Set(lines.map((x) => x.id)).size !== lines.length || !lines.every((x) => Number.isSafeInteger(x.grossCents) && x.grossCents >= 0)) throw new RefundError("Invalid order pricing lines.", "REFUND_MONEY");
  const total = lines.reduce((sum, x) => sum + x.grossCents, 0);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents > total) throw new RefundError("The recorded discount does not match the item amounts.", "REFUND_MONEY");
  const parts = lines.map((x) => ({ ...x, discount: total ? proportional(discountCents, x.grossCents, total) : 0, remainder: total ? BigInt(discountCents) * BigInt(x.grossCents) % BigInt(total) : BigInt(0) }));
  const rest = discountCents - parts.reduce((sum, x) => sum + x.discount, 0);
  const priority = [...parts].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < rest; i++) priority[i].discount++;
  return parts.map((x) => ({ id: x.id, netCents: x.grossCents - x.discount }));
}
export type RefundableLine = { id: string; quantity: number; refundedQuantity: number; netCents: number; refundedCents: number; dispatched: boolean; paid: boolean };
/** Amounts come only from locked purchase snapshots, never today's catalog. */
export function refundPlan(lines: RefundableLine[], selected: { itemId: string; quantity: number }[] | "FULL", shippingRemaining: number) {
  const wanted = selected === "FULL" ? lines.filter((x) => x.paid && (x.refundedQuantity < x.quantity || x.refundedCents < x.netCents)).map((x) => ({ itemId: x.id, quantity: x.quantity - x.refundedQuantity })) : selected;
  if (!wanted.length || new Set(wanted.map((x) => x.itemId)).size !== wanted.length) throw new RefundError("Choose remaining refundable items.", "REFUND_ITEMS", 400);
  const result = wanted.map((choice) => {
    const line = lines.find((x) => x.id === choice.itemId);
    if (!line || !line.paid || !Number.isInteger(choice.quantity) || choice.quantity < (selected === "FULL" ? 0 : 1) || choice.quantity > line.quantity - line.refundedQuantity) throw new RefundError("The selected quantity is not paid or has already been refunded.", "REFUND_ITEMS");
    const remaining = line.netCents - line.refundedCents, units = line.quantity - line.refundedQuantity;
    if (remaining < 0) throw new RefundError("This item needs financial reconciliation.", "REFUND_MONEY");
    return { itemId: line.id, quantity: choice.quantity, amountCents: units ? proportional(remaining, choice.quantity, units) : remaining, offset: line.refundedQuantity, beforeDispatch: !line.dispatched };
  });
  const goodsRemaining = lines.reduce((sum, x) => sum + x.netCents - x.refundedCents, 0);
  const beforeDispatchAmount = result.filter((x) => x.beforeDispatch).reduce((sum, x) => sum + x.amountCents, 0);
  // Only the eligible, undispatched goods' share of the remaining shipping is
  // returned. Selecting all undispatched goods before any dispatch returns all.
  const shippingCents = goodsRemaining ? proportional(shippingRemaining, beforeDispatchAmount, goodsRemaining) : selected === "FULL" && lines.every((x) => !x.dispatched && x.paid) ? shippingRemaining : 0;
  return { lines: result, shippingCents, amountCents: result.reduce((sum, x) => sum + x.amountCents, shippingCents) };
}
