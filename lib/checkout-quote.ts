import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { quoteRequestSchema } from "@/lib/validations/order";

export class CheckoutQuoteError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
export type CheckoutQuote = {
  currency: "BDT"; subtotal: number; discountAmount: number; shippingFee: number; total: number;
  coupon: { code: string; type: "percentage" | "fixed"; value: number } | null;
  items: { productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  fingerprint: string;
};

/** Shared by the read-only quote endpoint and the order transaction. */
export async function calculateCheckoutQuote(db: Pick<Prisma.TransactionClient, "product" | "coupon">, input: z.infer<typeof quoteRequestSchema>, now = new Date()): Promise<CheckoutQuote> {
  const products = await db.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) } }, select: {
    id: true, name: true, status: true, stock: true, price: true, discountPrice: true,
    seller: { select: { sellerStatus: true } },
  } });
  let subtotal = new Prisma.Decimal(0);
  const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)).map((line) => {
    const product = products.find((item) => item.id === line.productId);
    if (!product || product.status !== "APPROVED" || product.seller.sellerStatus !== "APPROVED") throw new CheckoutQuoteError("One or more selected products are no longer available.", "PRODUCT_UNAVAILABLE");
    if (product.stock < line.quantity) throw new CheckoutQuoteError(`Insufficient stock for ${product.name}.`, "OUT_OF_STOCK");
    const unitPrice = product.discountPrice ?? product.price;
    if (product.price.lte(0) || unitPrice.lt(0) || unitPrice.gt(product.price)) throw new CheckoutQuoteError("A product price is unavailable. Please contact support.", "INVALID_PRICE");
    const lineTotal = unitPrice.mul(line.quantity);
    subtotal = subtotal.add(lineTotal);
    return { productId: product.id, name: product.name, quantity: line.quantity, unitPrice: Number(unitPrice), lineTotal: Number(lineTotal) };
  });
  let discount = new Prisma.Decimal(0);
  let coupon: CheckoutQuote["coupon"] = null;
  if (input.couponCode) {
    const record = await db.coupon.findUnique({ where: { code: input.couponCode.trim().toUpperCase() } });
    if (!record?.isActive || (record.expiresAt && record.expiresAt <= now)) throw new CheckoutQuoteError("This coupon is invalid or expired.", "INVALID_COUPON");
    if (record.minSpend && subtotal.lt(record.minSpend)) throw new CheckoutQuoteError(`This coupon requires a subtotal of BDT ${record.minSpend.toFixed(2)}.`, "COUPON_MIN_SPEND");
    if (record.discount.lte(0) || (record.isPercentage && record.discount.gt(100))) throw new CheckoutQuoteError("This coupon is not available.", "INVALID_COUPON");
    discount = record.isPercentage ? subtotal.mul(record.discount).div(100) : record.discount;
    discount = Prisma.Decimal.min(subtotal, discount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    coupon = { code: record.code, type: record.isPercentage ? "percentage" : "fixed", value: Number(record.discount) };
  }
  const shipping = subtotal.gt(0) && subtotal.lte(50000) ? 150 : 0;
  const total = subtotal.sub(discount).add(shipping).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (total.gt("99999999.99")) throw new CheckoutQuoteError("Order total exceeds the supported limit. Split your order.", "INVALID_TOTAL");
  if (input.paymentMethod === "STRIPE" && total.lt(1)) throw new CheckoutQuoteError("Card checkout requires an order total of at least BDT 1.", "INVALID_TOTAL");
  const values = { currency: "BDT" as const, subtotal: Number(subtotal), discountAmount: Number(discount), shippingFee: shipping, total: Number(total), coupon, items };
  return { ...values, fingerprint: createHash("sha256").update(JSON.stringify(values)).digest("hex") };
}
