import { z } from "zod";
import { MAX_PRODUCT_IMAGES } from "@/lib/product-media-policy";

export const MAX_PRODUCT_PRICE = 99_999_999.99; // PostgreSQL DECIMAL(10, 2)
export const MAX_PRODUCT_STOCK = 2_147_483_647; // PostgreSQL INTEGER
export const MAX_PRODUCT_DESCRIPTION = 20_000;
export const catalogIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/, "Invalid catalog identifier.");
export const productPriceSchema = z.number().min(0.01, "Price must be at least 0.01 BDT.").max(MAX_PRODUCT_PRICE, "Price exceeds the database limit.").multipleOf(0.01, "Use at most two decimal places.");
export const productStatusSchema = z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]);
export const sellerStatusSchema = z.enum(["APPROVED", "BLOCKED", "PENDING", "REJECTED"]);
export const productImageUrlSchema = z.string().min(1).max(2048).refine((value) => {
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/")) return /^\/(?:images\/|assets\/)?[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/.test(value) && !/(?:^|\/)\.\.(?:\/|$)/.test(value) && !value.startsWith("//");
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash; } catch { return false; }
}, "Use a bounded HTTPS image URL or a local public asset path.");
export const productUploadKeySchema = z.string().max(160).regex(/^products\/[A-Za-z0-9-]{1,64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/, "Select a valid uploaded product image.");
const fields = {
  name: z.string().trim().min(3, "Product name must be at least 3 characters.").max(120),
  description: z.string().max(MAX_PRODUCT_DESCRIPTION).optional(),
  price: productPriceSchema,
  discountPrice: productPriceSchema.nullable().optional(),
  stock: z.number().int().min(0).max(MAX_PRODUCT_STOCK),
  categoryId: catalogIdSchema,
  brandId: catalogIdSchema.nullable().optional(),
  isFeatured: z.boolean().optional().default(false),
};
function discountValid(data: { price?: number; discountPrice?: number | null }) { return data.price === undefined || data.discountPrice == null || data.discountPrice < data.price; }
const discountRule = { message: "Discount price must be lower than the regular price.", path: ["discountPrice"] };
const imageList = z.array(productImageUrlSchema).max(MAX_PRODUCT_IMAGES).refine((values) => new Set(values).size === values.length, "Gallery images must be distinct.");

const createFields = z.object({
  ...fields,
  imageUrl: productImageUrlSchema.optional(),
  images: imageList.optional().default([]),
  uploadKeys: z.array(productUploadKeySchema).min(1, "Upload at least one product image.").max(MAX_PRODUCT_IMAGES).refine((values) => new Set(values).size === values.length, "Select distinct uploaded images."),
}).strict();
export const createProductSchema = createFields.refine(discountValid, discountRule);

export const updateProductSchema = createFields.partial().extend({ id: catalogIdSchema }).strict().refine(discountValid, discountRule);
export const productPriceUpdateSchema = z.object({ productId: catalogIdSchema, price: productPriceSchema, discountPrice: productPriceSchema.nullable().optional() }).strict().refine(discountValid, discountRule);
export const productStatusUpdateSchema = z.object({ productId: catalogIdSchema, status: productStatusSchema }).strict();
export const sellerStatusUpdateSchema = z.object({ sellerId: catalogIdSchema, sellerStatus: sellerStatusSchema }).strict();
export const productApprovalSchema = z.object({ ...fields, imageUrl: productImageUrlSchema.nullable(), images: imageList }).strict().refine(discountValid, discountRule).refine((data) => Boolean(data.imageUrl) && (!data.images.length || data.images[0] === data.imageUrl), "A valid cover and matching ordered gallery are required before approval.");

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(1_000_000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(12),
  search: z.string().max(200).optional(),
  categoryId: catalogIdSchema.optional(), brandId: catalogIdSchema.optional(),
  minPrice: z.coerce.number().min(0).max(MAX_PRODUCT_PRICE).optional(),
  maxPrice: z.coerce.number().min(0).max(MAX_PRODUCT_PRICE).optional(),
  status: productStatusSchema.optional(),
  sort: z.enum(["latest", "price_low", "price_high", "rating"]).optional().default("latest"),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
