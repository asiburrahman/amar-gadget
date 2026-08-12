import { z } from "zod";

export const orderItemSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
});

export const checkoutSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Cart cannot be empty"),
  shippingAddress: z.object({
    street: z.string().min(3),
    city: z.string().min(2),
    postalCode: z.string().min(2),
    country: z.string().min(2).default("Bangladesh"),
  }).optional(),
});

export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;