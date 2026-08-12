import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(3, "Product name must be at least 3 characters").max(100),
  description: z.string().optional(),
  price: z.number().positive("Price must be greater than 0"),
  stock: z.number().int().nonnegative("Stock cannot be negative"),
  imageUrl: z.string().url("Invalid image URL").optional(),
  categoryId: z.string().uuid("Invalid category ID"),
});

export const updateProductSchema = createProductSchema.partial().extend({
  id: z.string().uuid("Invalid product ID"),
});

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(["PENDING_APPROVAL", "PUBLISHED", "REJECTED"]).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;