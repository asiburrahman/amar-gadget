import { z } from "zod";

export const orderItemSchema = z.object({
  productId: z.string().min(1, "Invalid product ID"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
});

export const checkoutSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Cart cannot be empty"),
  fullName: z.string().min(2, "Full name is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  street: z.string().min(3, "Street address is required"),
  city: z.string().min(2, "City is required"),
  district: z.string().min(2, "District is required"),
  zipCode: z.string().optional(),
  paymentMethod: z.enum(["COD", "STRIPE"]).default("COD"),
  couponCode: z.string().optional(),
});

export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;