import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const version = z.number().int().min(1).max(2147483646);
const requestId = z.string().uuid().transform((value) => value.toLowerCase());
const money = z.number().finite().min(0).max(99_999_999.99).refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 0.000001, "Use at most two decimal places.");
export const couponFieldsSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(64).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  discount: money.refine((value) => value > 0, "Discount must be positive."), isPercentage: z.boolean(),
  minSpend: money.nullable(), expiresAt: z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value))).nullable(), isActive: z.boolean(),
}).strict().refine((value) => !value.isPercentage || value.discount <= 100, "Percentage discounts cannot exceed 100.");
const target = z.object({ id, version }).strict();
export const couponActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId, fields: couponFieldsSchema }).strict(),
  z.object({ action: z.literal("update"), requestId, ...target.shape, fields: couponFieldsSchema }).strict(),
  z.object({ action: z.literal("activation"), requestId, ...target.shape, isActive: z.boolean() }).strict(),
  z.object({ action: z.literal("preview"), target: target.nullable(), fields: couponFieldsSchema, subtotal: z.number().finite().min(0).max(999_999_999_900).refine((value) => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(Math.round(value * 100) - value * 100) < 0.000001), paymentMethod: z.enum(["COD", "STRIPE"]) }).strict(),
]);
export const couponQuerySchema = z.object({ mode: z.enum(["list", "record", "history"]).default("list"), id: id.optional(), requestId: requestId.optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), q: z.string().trim().max(64).default(""), status: z.enum(["ALL", "ACTIVE", "INACTIVE", "EXPIRED"]).default("ALL") }).strict().refine((value) => value.mode === "list" || !!value.id);
export type CouponFields = z.infer<typeof couponFieldsSchema>;
export type CouponAction = z.infer<typeof couponActionSchema>;
