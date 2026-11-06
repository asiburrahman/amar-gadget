import { Prisma } from "@prisma/client";
export class CheckoutQuoteError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
export type CouponRule = { code: string; discount: Prisma.Decimal; isPercentage: boolean; minSpend: Prisma.Decimal | null; expiresAt: Date | null; isActive: boolean };
export function checkoutTotals(subtotal: Prisma.Decimal, method: "COD" | "STRIPE", record: CouponRule | null, required = false, now = new Date()) {
  let discount = new Prisma.Decimal(0);
  let coupon: { code: string; type: "percentage" | "fixed"; value: number } | null = null;
  if (required || record) {
    if (!record?.isActive || (record.expiresAt && record.expiresAt <= now)) throw new CheckoutQuoteError("This coupon is invalid or expired.", "INVALID_COUPON");
    if (record.minSpend?.lt(0) || record.discount.lte(0) || (record.isPercentage && record.discount.gt(100))) throw new CheckoutQuoteError("This coupon is not available.", "INVALID_COUPON");
    if (record.minSpend && subtotal.lt(record.minSpend)) throw new CheckoutQuoteError(`This coupon requires a subtotal of BDT ${record.minSpend.toFixed(2)}.`, "COUPON_MIN_SPEND");
    discount = record.isPercentage ? subtotal.mul(record.discount).div(100) : record.discount;
    discount = Prisma.Decimal.min(subtotal, discount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    coupon = { code: record.code, type: record.isPercentage ? "percentage" : "fixed", value: Number(record.discount) };
  }
  const shippingFee = subtotal.gt(0) && subtotal.lte(50000) ? 150 : 0;
  const total = subtotal.sub(discount).add(shippingFee).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (total.gt("99999999.99")) throw new CheckoutQuoteError("Order total exceeds the supported limit. Split your order.", "INVALID_TOTAL");
  if (method === "STRIPE" && total.lt(1)) throw new CheckoutQuoteError("Card checkout requires an order total of at least BDT 1.", "INVALID_TOTAL");
  return { currency: "BDT" as const, subtotal: Number(subtotal), discountAmount: Number(discount), shippingFee, total: Number(total), coupon };
}
