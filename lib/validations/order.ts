import { z } from "zod";

export const orderItemSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.number().int().positive("Quantity must be at least 1").max(100),
});

export const checkoutDetailsSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Cart cannot be empty").max(100)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Duplicate products are not allowed"),
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  phone: z.string().trim().min(10, "Valid phone number is required").max(30)
    .regex(/^\+?[\d\s()-]+$/, "Valid phone number is required")
    .refine((phone) => { const digits = phone.replace(/\D/g, "").length; return digits >= 10 && digits <= 15; }, "Valid phone number is required"),
  street: z.string().trim().min(3, "Street address is required").max(500),
  city: z.string().trim().min(2, "City is required").max(100),
  district: z.string().trim().min(2, "District is required").max(100),
  zipCode: z.string().trim().max(20).optional(),
  paymentMethod: z.enum(["COD", "STRIPE"]).default("COD"),
  couponCode: z.string().trim().toUpperCase().max(64).optional(),
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
