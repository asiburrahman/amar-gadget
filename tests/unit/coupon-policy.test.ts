import { Prisma } from "@prisma/client";
import { checkoutTotals, type CouponRule } from "@/lib/coupon-policy";
import { couponActionSchema } from "@/lib/validations/coupon";
const decimal = (value: string | number) => new Prisma.Decimal(value);
const rule = (data: Partial<CouponRule> = {}): CouponRule => ({ code: "TEST", discount: decimal(12.5), isPercentage: true, minSpend: null, expiresAt: null, isActive: true, ...data });
it("rounds half cents once, caps fixed benefits and includes the minimum-spend boundary", () => {
  expect(checkoutTotals(decimal(1), "COD", rule({ discount: decimal(0.5) }))).toMatchObject({ discountAmount: 0.01, total: 150.99 });
  expect(checkoutTotals(decimal(100), "COD", rule({ discount: decimal(300), isPercentage: false, minSpend: decimal(100) }))).toMatchObject({ discountAmount: 100, shippingFee: 150, total: 150 });
  expect(() => checkoutTotals(decimal(99.99), "COD", rule({ minSpend: decimal(100) }))).toThrow("requires a subtotal");
});
it.each([rule({ isActive: false }), rule({ expiresAt: new Date(1000) }), rule({ discount: decimal(101) }), rule({ discount: decimal(-1) }), rule({ minSpend: decimal(-1) })])("rejects unavailable or corrupt historical rules", (coupon) => {
  expect(() => checkoutTotals(decimal(100), "COD", coupon, true, new Date(1000))).toThrow();
});
it("keeps shipping independent of coupon and enforces card and maximum-total boundaries", () => {
  expect(checkoutTotals(decimal(50000), "COD", rule({ discount: decimal(100) }))).toMatchObject({ total: 150, shippingFee: 150 });
  expect(checkoutTotals(decimal(50000.01), "COD", null)).toMatchObject({ shippingFee: 0 });
  expect(checkoutTotals(decimal(0), "COD", null)).toMatchObject({ total: 0, shippingFee: 0 });
  expect(() => checkoutTotals(decimal(50000.01), "STRIPE", rule({ discount: decimal(100) }))).toThrow("at least BDT 1");
  expect(() => checkoutTotals(decimal(100000000), "COD", null)).toThrow("supported limit");
  expect(() => checkoutTotals(decimal(100), "COD", null, true)).toThrow("invalid or expired");
});
it("validates normalized draft codes, strict fields and exact supported decimal precision", () => {
  const input = { action: "preview", target: null, fields: { code: " test ", discount: 12.5, isPercentage: true, minSpend: 100, expiresAt: null, isActive: true }, subtotal: 100, paymentMethod: "COD" };
  expect(couponActionSchema.parse(input)).toMatchObject({ fields: { code: "TEST" } });
  for (const fields of [{ discount: 101 }, { discount: 0.001 }, { minSpend: -1 }, { code: "BAD\nCODE" }, { expiresAt: "tomorrow" }, { ownerId: "forged" }]) expect(couponActionSchema.safeParse({ ...input, fields: { ...input.fields, ...fields } }).success).toBe(false);
});
