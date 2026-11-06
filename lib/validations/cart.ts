import { z } from "zod";
import { catalogIdSchema } from "@/lib/validations/product";
import type { WishlistProduct } from "@/lib/validations/wishlist";

export const MAX_CART_LINES = 100;
export const cartVersionSchema = z.number().int().min(0).max(2_147_483_646);
export const cartCouponSchema = z.string().trim().toUpperCase().min(1).max(64).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a valid coupon code.").nullable();
export const cartSelectionLineSchema = z.object({
  productId: z.string().uuid(), lineId: catalogIdSchema, quantity: z.number().int().min(1).max(100),
}).strict();
const selectedLines = z.array(cartSelectionLineSchema).min(1).max(MAX_CART_LINES)
  .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length && new Set(lines.map((line) => line.lineId)).size === lines.length, "Choose distinct cart lines.");
export const cartCheckoutSchema = z.object({
  ownerId: catalogIdSchema.nullable(), sourceId: z.string().uuid().nullable(), version: cartVersionSchema,
  couponVersion: cartVersionSchema, couponCode: cartCouponSchema, lines: selectedLines,
  previousReceiptId: z.string().uuid().nullable().optional(),
}).strict().refine((input) => input.ownerId === null ? input.sourceId !== null : input.sourceId === null && input.previousReceiptId == null, "Check the cart account context.");
const mutationBase = { requestId: z.string().uuid(), version: cartVersionSchema };
export const cartMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...mutationBase, action: z.literal("set"), productId: z.string().uuid(), lineId: catalogIdSchema.nullable(), quantity: z.number().int().min(1).max(100) }).strict(),
  z.object({ ...mutationBase, action: z.literal("remove"), lineId: catalogIdSchema }).strict(),
  z.object({ ...mutationBase, action: z.literal("clear") }).strict(),
  z.object({ ...mutationBase, action: z.literal("coupon"), code: cartCouponSchema }).strict(),
  z.object({ ...mutationBase, action: z.literal("merge"), items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(MAX_CART_LINES).refine((items) => new Set(items.map((item) => item.productId)).size === items.length) }).strict(),
]);
export const guestCartResolveSchema = z.object({ lines: z.array(cartSelectionLineSchema).max(MAX_CART_LINES).refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length && new Set(lines.map((line) => line.lineId)).size === lines.length) }).strict();
export type CartCheckoutContext = z.infer<typeof cartCheckoutSchema>;
export type CartMutation = z.infer<typeof cartMutationSchema>;
export type CartViewLine = { id: string; lineId: string; lineVersion: number; quantity: number; product: WishlistProduct | null };
export type CartPending = { items: { productId: string; quantity: number; lineId?: string }[]; couponCode: string | null; couponVersion: number | null; ownerId: string | null; sourceId: string | null; version?: number | null };
export type CartRecentCheckout = { id: string; status: string; paymentStatus: string; paymentMethod: string; createdAt: string };
export type AccountCartSnapshot = { ownerId: string; version: number; couponVersion: number; couponCode: string | null; lines: CartViewLine[]; pendingCheckouts: Record<string, CartPending>; recentCheckout?: CartRecentCheckout | null };
