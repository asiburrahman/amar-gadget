import { z } from "zod";
import { shippingAddressSchema } from "@/lib/validations/address";
import { cartCheckoutSchema } from "@/lib/validations/cart";

export const orderItemSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.number().int().positive("Quantity must be at least 1").max(100),
});

export const checkoutDetailsSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Cart cannot be empty").max(100)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Duplicate products are not allowed"),
  ...shippingAddressSchema.omit({ zipCode: true }).shape,
  zipCode: z.string().trim().max(20).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use plain text.").optional(),
  paymentMethod: z.enum(["COD", "STRIPE"]).default("COD"),
  couponCode: z.string().trim().toUpperCase().max(64).optional(),
  cart: cartCheckoutSchema.optional(),
});

export const checkoutSchema = checkoutDetailsSchema.extend({
  // This is a secret capability, not a public order ID. The browser generates
  // 256 random bits and reuses them only for an identical checkout intent.
  checkoutToken: z.string().regex(/^[a-f0-9]{64}$/, "Invalid checkout attempt"),
  quoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const quoteRequestSchema = checkoutDetailsSchema.pick({ items: true, couponCode: true, paymentMethod: true });

export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutDetails = z.infer<typeof checkoutDetailsSchema>;
