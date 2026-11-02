import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { quoteRequestSchema } from "@/lib/validations/order";

import { checkoutTotals, CheckoutQuoteError } from "@/lib/coupon-policy";
export { CheckoutQuoteError };
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
  const record = input.couponCode ? await db.coupon.findUnique({ where: { code: input.couponCode.trim().toUpperCase() } }) : null;
  const values = { ...checkoutTotals(subtotal, input.paymentMethod, record, !!input.couponCode, now), items };
  return { ...values, fingerprint: createHash("sha256").update(JSON.stringify(values)).digest("hex") };
}
