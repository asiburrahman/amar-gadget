import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(3, "Product name must be at least 3 characters").max(120),
  description: z.string().optional(),
  price: z.number().positive("Price must be greater than 0"),
  discountPrice: z.number().positive("Discount price must be positive").optional().nullable(),
  stock: z.number().int().nonnegative("Stock cannot be negative"),
  imageUrl: z.string().optional(),
  images: z.array(z.string()).optional().default([]),
  categoryId: z.string().min(1, "Category is required"),
  brandId: z.string().optional().nullable(),
  isFeatured: z.boolean().optional().default(false),
});

export const updateProductSchema = createProductSchema.partial().extend({
  id: z.string().min(1, "Invalid product ID"),
});

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(12),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]).optional(),
  sort: z.enum(["latest", "price_low", "price_high", "rating"]).optional().default("latest"),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;